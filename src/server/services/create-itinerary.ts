import type { Coordinate, Place, WalkingRoute } from "@/domain/models";
import type { DayActivity, ActivityLeg } from "@/domain/meal-planning";
import { scheduleAvailableDay } from "@/domain/meal-planning";
import { uniqueItineraryVisits } from "@/domain/itinerary-selection";
import { matchingByName } from "@/domain/place-name";
import {
  briefDays,
  briefBudget,
  tripPurposeLabels,
  type TripBrief,
  type TripPurpose,
} from "@/domain/trip-brief";
import type {
  Itinerary,
  ItineraryCandidate,
  ItineraryStage,
  ItineraryWork,
  SocialSource,
} from "@/domain/itinerary";
import {
  itinerarySchema,
  itineraryOutlineSchema,
  socialSourceSchema,
} from "@/lib/itinerary-contracts";
import type { SocialReferenceProvider } from "@/server/providers/social-catalog";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";
import { placeSchema, walkingSchema } from "@/lib/contracts";
import type { ItineraryModel } from "@/server/ai/itinerary-model";
import { withAiBudget, withItineraryBudget } from "@/server/ai/budget";
import { providerWaitMs } from "@/server/providers/budget";
import { ProviderError } from "@/server/providers/errors";

export interface ItineraryProvider {
  search(city: string, keyword: string, signal?: AbortSignal): Promise<Place[]>;
  walking(
    origin: Coordinate,
    destination: Coordinate,
    signal?: AbortSignal,
  ): Promise<WalkingRoute>;
}
const queries: Record<TripPurpose, string[]> = {
  local_life: ["历史街区", "传统市场"],
  culture: ["博物馆", "文化古迹"],
  nature: ["风景名胜", "公园"],
  food: ["美食街", "历史街区"],
  relaxation: ["公园", "休闲街区"],
  photography: ["观景台", "城市地标"],
};
const normalize = (text: string) =>
  text.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
async function turn(
  signal: AbortSignal,
  progress: (message: string, stage?: ItineraryStage) => void,
  stage: ItineraryStage,
) {
  signal.throwIfAborted();
  let wait = providerWaitMs();
  while (wait > 0) {
    if (wait > 1000) {
      progress("正在等待地图查询额度，已完成的安排保留。", stage);
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, wait);
      signal.addEventListener("abort", abort, { once: true });
    });
    signal.throwIfAborted();
    wait = providerWaitMs();
  }
}
// A transient supplier failure (network, timeout, local or upstream rate limit) is
// queried once more; "no route" and permission failures are reported immediately.
// Geometry is never invented for a leg that still fails.
function retryableRouteFailure(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    ["rate_limited", "upstream_http", "unavailable"].includes(error.code)
  );
}
async function fetchWalking(
  provider: ItineraryProvider,
  origin: Coordinate,
  destination: Coordinate,
  signal: AbortSignal,
  progress: (message: string, stage?: ItineraryStage) => void,
): Promise<WalkingRoute | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await turn(signal, progress, "routes");
    try {
      return walkingSchema.parse(await provider.walking(origin, destination, signal));
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 1 || !retryableRouteFailure(error)) {
        return null;
      }
    }
  }
  return null;
}

export async function createItinerary(
  raw: TripBrief,
  provider: ItineraryProvider,
  ai: ItineraryModel,
  signal: AbortSignal,
  progress: (
    message: string,
    stage?: ItineraryStage,
    work?: ItineraryWork,
  ) => void = () => {},
  socialProvider?: SocialReferenceProvider,
): Promise<Itinerary> {
  const brief = tripBriefSchema.parse(raw);
  return withItineraryBudget(async () => {
    let socialSource: SocialSource | undefined;
    if (socialProvider && !brief.socialInspiration) {
      progress("正在检查后台可用的同城社交参考资料。", "places");
      try {
        socialSource = socialSourceSchema.parse(await socialProvider.load(brief, signal));
        if (
          socialSource.status === "available" &&
          normalize(socialSource.references.city) !== normalize(brief.destinationCity)
        ) {
          socialSource = { status: "unavailable" };
        }
      } catch {
        signal.throwIfAborted();
        socialSource = { status: "unavailable" };
      }
    }
    const references =
      brief.socialInspiration ??
      (socialSource?.status === "available" ? socialSource.references : undefined);
    const modelBrief = references ? { ...brief, socialInspiration: references } : brief;
    const candidates: ItineraryCandidate[] = [];
    const searches = new Map<string, Place[]>();
    async function search(
      query: string,
      kind: ItineraryCandidate["kind"],
      exactOnly = false,
    ) {
      signal.throwIfAborted();
      let found = searches.get(query);
      if (!found) {
        await turn(signal, progress, "places");
        found = (await provider.search(brief.destinationCity, query, signal))
          .map((place) => placeSchema.parse(place))
          .filter((place) => place.source.kind !== "user");
        searches.set(query, found);
      }
      const usable = exactOnly
        ? matchingByName(query, found, (place) => place.name)
        : found;
      if (exactOnly && usable.length !== 1) {
        return found;
      }
      for (const place of usable) {
        if (
          !candidates.some(
            (candidate) => candidate.kind === kind && candidate.place.id === place.id,
          )
        ) {
          candidates.push({ place, kind, query });
        }
      }
      return found;
    }
    progress("正在核对必去地点、必吃需求与目的地候选。", "places");
    const required = new Map<string, string>();
    for (const name of brief.mustVisit) {
      const found = matchingByName(
        name,
        await search(name, "visit"),
        (place) => place.name,
      );
      if (found.length !== 1) {
        throw new ProviderError(
          "unavailable",
          `必去地点“${name}”未获得唯一匹配，请填写明确的地点名称。`,
          "no_place",
        );
      }
      required.set(name, found[0].id);
    }
    const foodVenues = new Map<string, string>();
    for (const request of brief.mustEat) {
      const found = await search(request.name, "restaurant");
      if (request.kind === "restaurant") {
        const exact = matchingByName(request.name, found, (place) => place.name);
        if (exact.length !== 1) {
          throw new ProviderError(
            "unavailable",
            `必吃餐厅“${request.name}”未获得唯一匹配，请填写明确店名。`,
            "no_place",
          );
        }
        foodVenues.set(request.name, exact[0].id);
      }
    }
    const socialNotices: string[] = [];
    const checkedSocialPlaces = new Set<string>();
    for (const note of references?.notes ?? []) {
      for (const place of note.places) {
        const key = `${place.kind}:${normalize(place.name)}`;
        if (checkedSocialPlaces.has(key)) {
          continue;
        }
        checkedSocialPlaces.add(key);
        progress("正在核对社交参考中的推荐地点，不把帖子当作路线或营业证据。", "places");
        try {
          const exact = matchingByName(
            place.name,
            await search(place.name, place.kind, true),
            (found) => found.name,
          );
          if (exact.length !== 1) {
            socialNotices.push(
              `社交推荐“${place.name}”未匹配唯一公共地点，不视为已核实或必去约束。`,
            );
          }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof ProviderError && error.status !== "unavailable") {
            throw error;
          }
          socialNotices.push(
            `社交推荐“${place.name}”的地点检索未完成；未用帖子补造坐标、时刻或价格。`,
          );
        }
      }
    }
    const visitQueries = [
      ...new Set(
        [brief.mainPurpose, ...brief.secondaryPurposes]
          .flatMap((purpose) => queries[purpose])
          .concat(["博物馆", "公园", "历史街区", "风景名胜", "城市地标"]),
      ),
    ];
    for (const query of visitQueries) {
      if (
        candidates.filter((candidate) => candidate.kind === "visit").length >=
        Math.max(brief.dayCount * 2, 6)
      ) {
        break;
      }
      await search(query, "visit");
    }
    for (const query of ["早餐店", "本地特色餐厅", "地方菜"]) {
      await search(query, "restaurant");
    }
    if (
      candidates.filter((candidate) => candidate.kind === "visit").length <
        brief.dayCount ||
      !candidates.some((candidate) => candidate.kind === "restaurant")
    ) {
      throw new ProviderError(
        "unavailable",
        "真实景点或餐厅候选不足以安排当前天数，请调整目的地或天数。",
        "no_place",
      );
    }
    progress("AI 正在结合旅行目的、可用时间与预算选择每日活动和三餐。", "model");
    const parsedOutline = itineraryOutlineSchema.safeParse(
      await withAiBudget(() => ai.compose(modelBrief, candidates, signal)),
    );
    if (!parsedOutline.success) {
      throw new ProviderError(
        "unavailable",
        "AI 返回的地点或建议结构无效，方案未应用。",
        "ai_invalid_response",
      );
    }
    let outline = parsedOutline.data;
    if (outline.days.length !== brief.dayCount) {
      throw new ProviderError(
        "unavailable",
        "AI 返回的天数不匹配，未使用不完整方案。",
        "ai_invalid_response",
      );
    }
    for (const day of outline.days) {
      for (const choice of day.visits) {
        if (
          !candidates.some(
            (candidate) =>
              candidate.kind === "visit" && candidate.place.id === choice.placeId,
          )
        ) {
          throw new ProviderError(
            "unavailable",
            "AI 选择了候选之外的景点，方案未应用。",
            "ai_invalid_response",
          );
        }
      }
      for (const meal of [day.breakfast, day.lunch, day.dinner]) {
        if (
          !candidates.some(
            (candidate) =>
              candidate.kind === "restaurant" && candidate.place.id === meal.placeId,
          )
        ) {
          throw new ProviderError(
            "unavailable",
            "AI 返回了无效餐厅，方案未应用。",
            "ai_invalid_response",
          );
        }
      }
    }
    const selection = uniqueItineraryVisits(
      outline,
      candidates,
      new Set(required.values()),
    );
    outline = selection.outline;
    const guides = new Map(
      outline.guides?.map(({ placeId, ...guide }) => [placeId, guide]) ?? [],
    );
    const generatedAt = new Date().toISOString();
    const days: Itinerary["days"] = [];
    for (const [index, availability] of briefDays(brief).entries()) {
      signal.throwIfAborted();
      const day = outline.days[index];
      progress(`正在核对第 ${index + 1} 天的相邻路线与时间。`, "routes", {
        completed: index,
        total: brief.dayCount,
      });
      if (!availability.activityWindow) {
        days.push({
          date: availability.date,
          theme: day.theme,
          schedule: null,
          recommendations: [],
          notices: ["该日期没有可游玩时段，保留抵达／离开与休息，不伪造活动时间。"],
        });
        continue;
      }
      const recommendations: Itinerary["days"][number]["recommendations"] = [];
      const activities: DayActivity[] = [];
      const notices: string[] = [];
      function add(
        choice: (typeof day.visits)[number],
        kind: DayActivity["kind"],
        window: DayActivity["window"],
        dish: string | null = null,
      ) {
        const candidate = candidates.find(
          (value) =>
            value.kind === (kind === "visit" ? "visit" : "restaurant") &&
            value.place.id === choice.placeId,
        )!;
        const id = `activity:trip-${index}-${activities.length}`;
        activities.push({
          id,
          kind,
          place: candidate.place,
          stayMinutes: choice.stayMinutes,
          window,
          fixedStartMinute: null,
          rules: null,
          meal:
            kind === "visit"
              ? null
              : {
                  perPersonFen: null,
                  dietaryCheck: "unknown",
                  source: { kind: "unverified", recordedAt: generatedAt },
                },
        });
        const guide = guides.get(choice.placeId);
        recommendations.push({
          activityId: id,
          reason: choice.reason,
          dish,
          ...(guide ? { guide: structuredClone(guide) } : {}),
        });
      }
      function meal(kind: "breakfast" | "lunch" | "dinner", start: number, end: number) {
        const window = {
          startMinute: Math.max(availability.activityWindow!.startMinute, start),
          endMinute: Math.min(availability.activityWindow!.endMinute, end),
        };
        if (window.endMinute - window.startMinute >= 45) {
          add(day[kind], kind, window, day[kind].dish);
        } else {
          notices.push(
            `${kind === "breakfast" ? "早餐" : kind === "lunch" ? "午餐" : "晚餐"}未纳入可用时段，请按抵达／离开情况自行安排；不算已覆盖。`,
          );
        }
      }
      meal("breakfast", 420, 600);
      add(day.visits[0], "visit", { ...availability.activityWindow });
      meal("lunch", 660, 840);
      for (const visit of day.visits.slice(1)) {
        add(visit, "visit", { ...availability.activityWindow });
      }
      meal("dinner", 1020, 1260);
      if (recommendations.some((item) => !item.guide)) {
        notices.push(
          "部分地点的详细体验建议缺失；已保留有效地点与排程，不补写虚构介绍。",
        );
      }
      const legs: ActivityLeg[] = [];
      for (let i = 1; i < activities.length; i++) {
        const fetched = await fetchWalking(
          provider,
          activities[i - 1].place.location,
          activities[i].place.location,
          signal,
          progress,
        );
        // A route recorded from the user's own input is not a verified supplier answer.
        let route: WalkingRoute | null = fetched?.source.kind === "user" ? null : fetched;
        if (route) {
          let points = 0;
          const segments = route.segments.filter((segment) => {
            points += segment.length;
            return points <= 500;
          });
          if (segments.length !== route.segments.length) {
            notices.push("部分路线轨迹过长，仅展示完整的可用轨迹段，不虚接缺失部分。");
          }
          route = { ...route, segments };
        } else {
          notices.push(
            "一段实际步行路线未核实，相关后续时刻保持未知；不会以直线距离补交通时间。",
          );
        }
        if (route?.seconds != null && route.seconds > 2400) {
          notices.push(
            "含超过 40 分钟的步行路段，需比较公共交通或调整地点；当前不冒称已获得公交方案。",
          );
        }
        legs.push({
          fromActivityId: activities[i - 1].id,
          toActivityId: activities[i].id,
          route,
        });
      }
      const schedule = scheduleAvailableDay({
        date: availability.date,
        timeZone: "Asia/Shanghai",
        startMinute: availability.activityWindow.startMinute,
        endMinute: availability.activityWindow.endMinute,
        bufferMinutes: 10,
        activities,
        legs,
      });
      days.push({
        date: availability.date,
        theme: day.theme,
        schedule,
        recommendations,
        notices: [...new Set(notices)],
      });
    }
    progress("路线核对完成，正在整理方案。", "routes", {
      completed: brief.dayCount,
      total: brief.dayCount,
    });
    const allItems = days.flatMap((day) => day.schedule?.items ?? []);
    const scheduledIds = new Set(
      allItems
        .filter((item) => item.activity.kind === "visit")
        .map((item) => item.activity.place.id),
    );
    const scheduledFoodIds = new Set(
      allItems
        .filter((item) => item.activity.kind !== "visit")
        .map((item) => item.activity.place.id),
    );
    const constraints: Itinerary["constraints"] = [...required].map(([label, id]) => ({
      label: `必去：${label}`,
      status: scheduledIds.has(id) ? "scheduled" : "conflict",
      message: scheduledIds.has(id)
        ? "已纳入时间轴，开放与预约仍需核实。"
        : "未纳入可用时段，请调整时间或需求；未静默视为满足。",
    }));
    for (const request of brief.mustEat) {
      const included =
        request.kind === "restaurant" &&
        scheduledFoodIds.has(foodVenues.get(request.name)!);
      constraints.push({
        label: `必吃：${request.name}`,
        status: request.kind === "restaurant" && !included ? "conflict" : "unverified",
        message:
          request.kind === "restaurant"
            ? included
              ? "餐厅已纳入，菜品供应、预约和饮食安全尚未核实。"
              : "指定餐厅未纳入，不能视为需求已满足。"
            : "菜品为用餐目标；搜索匹配不代表店内有售，需向商家核对。",
      });
      if (
        brief.dietary.allergies
          .concat(brief.dietary.avoid)
          .some((value) => normalize(value) === normalize(request.name))
      ) {
        constraints.push({
          label: `饮食冲突：${request.name}`,
          status: "conflict",
          message:
            "必吃需求同时出现在忌口／过敏原记录中，请先修改需求；不能据此保证饮食安全。",
        });
      }
    }
    const total = briefBudget(brief).totalFen;
    const weights = {
      intercity: brief.budget.includeIntercity ? 25 : 0,
      local: 10,
      lodging: brief.budget.includeLodging ? 30 : 0,
      meals: brief.mainPurpose === "food" ? 30 : 20,
      tickets: 15,
    };
    const entries = Object.entries(weights) as [keyof typeof weights, number][];
    const sum = entries.reduce((value, [, weight]) => value + weight, 0);
    const allocation = entries.map(([category, weight]) => ({
      category,
      targetFen: Math.floor((total * weight) / sum),
    }));
    allocation.find((item) => item.category === "meals")!.targetFen +=
      total - allocation.reduce((value, item) => value + item.targetFen, 0);
    return itinerarySchema.parse({
      brief,
      ...(socialSource ? { socialSource } : {}),
      title: outline.title,
      summary: outline.summary,
      days,
      constraints,
      allocation,
      model: ai.model,
      generatedAt,
      fixture: candidates.some((candidate) => candidate.place.source.kind === "fixture"),
      status:
        constraints.some((item) => item.status === "conflict") ||
        days.some((day) => day.schedule?.status === "infeasible")
          ? "infeasible"
          : "unverified",
      notices: [
        ...selection.notices,
        `按“${tripPurposeLabels[brief.mainPurpose]}”优先组织；选择与菜品描述为 AI 建议，非商家事实。`,
        "目前各段采用实际步行查询；公共交通方案、开放、预约、实际价格与天气仍待核实，不保证可直接执行。",
        "费用图表示预算目标的分配建议，不是实际报价或预算达标证明；早餐、午晚餐按真实可用时段纳入。",
        "10 分钟为独立规划缓冲，不是排队、候车或路段耗时；未发送精确住宿字段和自定义地图点，请勿在偏好中填写票据或联系方式。",
        "方案暂存在本页，刷新会丢失。",
        ...(references
          ? [
              socialSource?.status === "available"
                ? "参考了后台检索的同城社交资料，仅为未核实的旅行经验；来源列表不是逐活动引用或事实核验。"
                : "参考了用户选用的社交摘录，仅为未核实的旅行经验；来源列表不代表每处都已安排，地点、道路与营业／价格证据独立。",
              ...socialNotices,
            ]
          : []),
      ],
    });
  });
}

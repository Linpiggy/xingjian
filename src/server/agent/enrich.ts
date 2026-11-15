/**
 * 确定性增强：把模型给出的“当天地点 + 停留时长”变成可执行行程。
 * - 相邻地点用高德真实路线计算交通方式、时长和费用
 * - 排程器根据交通、营业时间、用餐窗口计算时刻
 * - 汇总预算（只计已知项，未知项单独列出，不当作 0）
 */
import { distanceMeters } from "@/lib/geo";
import { scheduleDay } from "@/lib/schedule";
import { trainFare } from "@/lib/train";
import type {
  Budget,
  Day,
  Intercity,
  Leg,
  Place,
  Station,
  Stop,
  Trip,
} from "@/lib/schema";
import { addDays, toMinutes } from "@/lib/time";

/** 晚于此时刻开始的午餐改按下午点心处理 */
const LATE_LUNCH_MIN = 15 * 60;
import { KNOWLEDGE_SOURCE } from "@/server/rag/corpus";
import type { AgentSession, DayDraft } from "./session";

const WALK_LIMIT_METERS = 1300;

async function computeLeg(session: AgentSession, from: Place, to: Place): Promise<Leg> {
  const { travelers, travelerType, accessibility } = session.request;
  const straight = distanceMeters(from.location, to.location);
  if (straight < 60) {
    return {
      mode: "walking",
      minutes: 2,
      meters: Math.round(straight),
      costCny: 0,
      summary: "同一区域，步行即达",
      path: [],
      alternative: null,
    };
  }
  try {
    if (straight <= WALK_LIMIT_METERS && !accessibility) {
      session.amapCalls += 1;
      const walk = await session.amap.walking(from.location, to.location);
      return { mode: "walking", ...walk, alternative: null };
    }
    const citycode = from.citycode ?? to.citycode;
    session.amapCalls += 2;
    const [transit, drive] = await Promise.all([
      citycode
        ? session.amap.transit(from.location, to.location, citycode).catch(() => null)
        : null,
      session.amap.driving(from.location, to.location).catch(() => null),
    ]);
    const cars = Math.ceil(travelers / 4);
    const taxiPerPerson =
      drive?.costCny != null ? Math.round((drive.costCny * cars) / travelers) : null;
    const preferTaxi =
      accessibility ||
      travelerType === "elderly" ||
      !transit ||
      (drive?.minutes != null &&
        transit.minutes != null &&
        transit.minutes > drive.minutes + 25);
    if (preferTaxi && drive) {
      return {
        mode: "taxi",
        minutes: drive.minutes,
        meters: drive.meters,
        costCny: taxiPerPerson,
        summary: `打车约 ${drive.minutes ?? "?"} 分钟${drive.costCny != null ? `，车费约 ¥${Math.round(drive.costCny)}/车` : ""}`,
        path: drive.path,
        alternative: transit
          ? `公交/地铁约 ${transit.minutes ?? "?"} 分钟：${transit.summary}`
          : null,
      };
    }
    if (transit) {
      return {
        mode: "transit",
        minutes: transit.minutes,
        meters: transit.meters,
        costCny: transit.costCny,
        summary: transit.summary,
        path: transit.path,
        alternative: drive
          ? `打车约 ${drive.minutes ?? "?"} 分钟${taxiPerPerson != null ? `，人均约 ¥${taxiPerPerson}` : ""}`
          : null,
      };
    }
  } catch {
    // 落到下方的“未知”分支，不伪造时长
  }
  return {
    mode: straight <= WALK_LIMIT_METERS ? "walking" : "taxi",
    minutes: null,
    meters: Math.round(straight),
    costCny: null,
    summary: "路线数据暂不可用，请出发前在地图应用中确认",
    path: [],
    alternative: null,
  };
}

/** 把车站包装成地点，复用市内路线计算 */
function stationPlace(station: Station): Place {
  return {
    id: `station-${station.name}`,
    name: station.name,
    address: null,
    location: station.location,
    type: "火车站",
    rating: null,
    avgCost: null,
    openTime: null,
    photos: [],
    citycode: station.citycode,
    adcode: null,
    category: "other",
    signatureDishes: [],
    tel: null,
  };
}

/** 门票来源只能是本次会话联网检索到的链接，或之前已核对并保存的来源 */
function resolveTicketSource(
  session: AgentSession,
  stop: DayDraft["stops"][number],
): Stop["ticketSource"] {
  if (stop.ticketSourceId) {
    const source = session.verifiedSources.get(stop.ticketSourceId);
    if (source) {
      return { ...source, checkedAt: new Date().toISOString().slice(0, 10) };
    }
  }
  return stop.ticketSource ?? null;
}

export async function buildDay(session: AgentSession, draft: DayDraft): Promise<Day> {
  const places = draft.stops.map((stop) => session.places.get(stop.placeId) as Place);
  const legs: Leg[] = [];
  for (let i = 1; i < places.length; i += 1) {
    legs.push(await computeLeg(session, places[i - 1], places[i]));
  }
  const totalDays = session.request.days;
  const arrivalTime = session.effectiveArrival();
  const departureTime = session.effectiveDeparture();
  const hotel = session.needsHotel() ? session.hotel?.place : null;
  const isLast = draft.day === totalDays;
  // 第一天乘车抵达时从到达站出发；最后一天乘车返程时以前往出发站结束；其余从住处出发、回到住处
  const arrivalStation =
    draft.day === 1 && session.intercity?.outbound
      ? session.intercity.arrivalStation
      : null;
  const departureStation =
    isLast && session.intercity?.inbound ? session.intercity.departureStation : null;
  const startFrom = arrivalStation ? stationPlace(arrivalStation) : hotel;
  const endAt = departureStation
    ? stationPlace(departureStation)
    : hotel && !isLast
      ? hotel
      : null;
  const startLeg = startFrom ? await computeLeg(session, startFrom, places[0]) : null;
  const endLeg = endAt
    ? await computeLeg(session, places[places.length - 1], endAt)
    : null;
  const { slots, warnings } = scheduleDay(
    session.request.pace,
    draft.stops.map((stop, i) => ({
      kind: stop.kind,
      mealType: stop.mealType,
      place: places[i],
      durationMin: stop.durationMin,
    })),
    legs,
    {
      startLeg,
      arrival: draft.day === 1 ? arrivalTime : null,
      arrivalSettle: arrivalStation ? 20 : undefined,
      departure: isLast ? departureTime : null,
      departureLeg: departureStation ? endLeg : null,
    },
  );
  const date = addDays(session.request.startDate, draft.day - 1);
  const weather = session.weather?.find((item) => item.date === date) ?? null;
  // 下午三点以后才吃的“午餐”实际是点心：改标为小食，避免时间轴出现 16 点吃午饭
  const lateLunch = (i: number) =>
    draft.stops[i].mealType === "lunch" &&
    (toMinutes(slots[i].start) ?? 0) >= LATE_LUNCH_MIN;
  const stops: Stop[] = draft.stops.map((stop, i) => ({
    kind: stop.kind,
    mealType: lateLunch(i) ? "snack" : stop.mealType,
    place: places[i],
    start: slots[i].start,
    end: slots[i].end,
    durationMin: stop.durationMin,
    title: stop.title,
    description: stop.description,
    highlights: stop.highlights,
    tips: stop.tips,
    ticketCny: stop.kind === "sight" ? stop.ticketCny : null,
    mealCny: stop.kind === "meal" ? (stop.mealCny ?? places[i].avgCost) : null,
    dishes: stop.dishes,
    citations: stop.citations.filter((id) => session.knowledge.has(id)),
    warnings: lateLunch(i)
      ? [
          ...slots[i].warnings.filter((warning) => !warning.startsWith("用餐时间偏晚")),
          "已过午餐时间，按下午点心安排",
        ]
      : slots[i].warnings,
    ticketSource: stop.kind === "sight" ? resolveTicketSource(session, stop) : null,
    locked: stop.locked ?? false,
    userEdited: stop.userEdited ?? false,
  }));
  if (weather && /雨|雪|雷/.test(weather.dayWeather)) {
    warnings.unshift(`当天预报${weather.dayWeather}，户外项目请备好雨具或准备室内备选`);
  }
  return {
    day: draft.day,
    date,
    theme: draft.theme,
    summary: draft.summary,
    stops,
    legs,
    startLeg,
    endLeg,
    weather,
    warnings,
  };
}

/** 已排好的一天转回草稿，用于手动编辑或住宿变更后重新排程 */
export function dayToDraft(day: Day): DayDraft {
  return {
    day: day.day,
    theme: day.theme,
    summary: day.summary,
    stops: day.stops.map((stop) => ({
      placeId: stop.place.id,
      kind: stop.kind,
      mealType: stop.mealType,
      durationMin: stop.durationMin,
      title: stop.title,
      description: stop.description,
      highlights: stop.highlights,
      tips: stop.tips,
      ticketCny: stop.ticketCny,
      mealCny: stop.mealCny,
      dishes: stop.dishes,
      citations: stop.citations,
      ticketSource: stop.ticketSource,
      locked: stop.locked,
      userEdited: stop.userEdited,
    })),
  };
}

function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.round(known.reduce((a, b) => a + b, 0)) : null;
}

export function computeBudget(
  days: Day[],
  travelers: number,
  hotelPerNightCny: number | null,
  hotelNote: string,
  intercity: Intercity | null = null,
): Budget {
  const stops = days.flatMap((day) => day.stops);
  const sights = stops.filter((stop) => stop.kind === "sight");
  const meals = stops.filter((stop) => stop.kind === "meal");
  const legs = days.flatMap((day) => [
    ...day.legs,
    ...(day.startLeg ? [day.startLeg] : []),
    ...(day.endLeg ? [day.endLeg] : []),
  ]);
  const unknownItems: string[] = [];
  const unknownTickets = sights.filter((stop) => stop.ticketCny === null);
  if (unknownTickets.length) {
    unknownItems.push(`${unknownTickets.length} 处景点门票未知`);
  }
  const unknownMeals = meals.filter((stop) => stop.mealCny === null);
  if (unknownMeals.length) {
    unknownItems.push(`${unknownMeals.length} 顿餐费未知`);
  }
  const unknownLegs = legs.filter((leg) => leg.costCny === null);
  if (unknownLegs.length) {
    unknownItems.push(`${unknownLegs.length} 段交通费用未知`);
  }
  const nights = Math.max(0, days.length - 1);
  const rooms = Math.ceil(travelers / 2);
  const hotel =
    nights === 0
      ? 0
      : hotelPerNightCny === null
        ? null
        : Math.round((hotelPerNightCny * nights * rooms) / travelers);
  if (hotel === null) {
    unknownItems.push("住宿费用未估算");
  }
  const hasTrains = Boolean(intercity?.outbound || intercity?.inbound);
  const rail = hasTrains
    ? sumKnown([
        trainFare(intercity?.outbound ?? null),
        trainFare(intercity?.inbound ?? null),
      ])
    : null;
  if (hasTrains && rail === null) {
    unknownItems.push("往返车票价格未知");
  }
  const tickets = sumKnown(sights.map((stop) => stop.ticketCny));
  const mealTotal = sumKnown(meals.map((stop) => stop.mealCny));
  const transport = sumKnown(legs.map((leg) => leg.costCny));
  return {
    tickets,
    meals: mealTotal,
    transport,
    hotel,
    intercity: rail,
    total:
      (tickets ?? 0) + (mealTotal ?? 0) + (transport ?? 0) + (hotel ?? 0) + (rail ?? 0),
    unknownItems,
    hotelNote:
      nights === 0
        ? "当日往返，不含住宿"
        : `${nights} 晚 × ${rooms} 间${hotelNote ? `，${hotelNote}` : ""}（AI 参考价，非实时报价）`,
  };
}

export function assembleTrip(
  session: AgentSession,
  args: {
    title: string;
    subtitle: string;
    overview: string;
    tips: { text: string; citations: string[] }[];
    packing: string[];
    hotelPerNightCny: number | null;
    hotelNote: string;
    changeSummary: string | null;
  },
): Trip {
  const days = [...session.days.values()].sort((a, b) => a.day - b.day);
  const tips = args.tips.map((tip) => ({
    text: tip.text,
    citations: tip.citations.filter((id) => session.knowledge.has(id)),
  }));
  const cited = new Set([
    ...tips.flatMap((tip) => tip.citations),
    ...days.flatMap((day) => day.stops.flatMap((stop) => stop.citations)),
  ]);
  return {
    title: args.title,
    subtitle: args.subtitle,
    city: session.request.city,
    overview: args.overview,
    days,
    tips,
    packing: args.packing,
    budget: computeBudget(
      days,
      session.request.travelers,
      args.hotelPerNightCny ?? session.hotel?.pricePerNightCny ?? null,
      session.hotel ? session.hotel.place.name : args.hotelNote,
      session.intercity,
    ),
    citations: [...cited].flatMap((id) => {
      const chunk = session.knowledge.get(id);
      return chunk
        ? [
            {
              id,
              title: chunk.title,
              source: chunk.source || KNOWLEDGE_SOURCE,
              excerpt: chunk.content,
            },
          ]
        : [];
    }),
    changeSummary: args.changeSummary,
    generatedAt: new Date().toISOString(),
    hotel: session.hotel,
    intercity: session.intercity,
    candidates: collectCandidates(session, days),
  };
}

/** 未被采用的景点与餐厅留作手动替换候选，各取最多 40 个 */
function collectCandidates(session: AgentSession, days: Day[]): Place[] {
  const used = new Set(days.flatMap((day) => day.stops.map((stop) => stop.place.id)));
  if (session.hotel) {
    used.add(session.hotel.place.id);
  }
  const rest = [...session.places.values()].filter((place) => !used.has(place.id));
  const food = rest.filter((place) => place.category === "food").slice(-40);
  const other = rest
    .filter((place) => place.category !== "food" && place.category !== "hotel")
    .slice(-40);
  return [...other, ...food];
}

/** 手动编辑后重算预算：住宿按原口径保留，其余按当前行程汇总 */
export function recomputeBudget(trip: Trip, travelers: number): Budget {
  const next = computeBudget(
    trip.days,
    travelers,
    trip.hotel?.pricePerNightCny ?? null,
    trip.hotel?.place.name ?? "",
    trip.intercity,
  );
  if (!trip.hotel) {
    const unknownItems = next.unknownItems.filter((item) => item !== "住宿费用未估算");
    const hotel = trip.budget.hotel;
    return {
      ...next,
      hotel,
      hotelNote: trip.budget.hotelNote,
      unknownItems: hotel === null ? [...unknownItems, "住宿费用未估算"] : unknownItems,
      total: next.total - (next.hotel ?? 0) + (hotel ?? 0),
    };
  }
  return next;
}

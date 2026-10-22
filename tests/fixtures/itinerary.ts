import type { TripBrief } from "@/domain/trip-brief";
import { briefDays, briefBudget } from "@/domain/trip-brief";
import type { Itinerary, ItineraryOutline, ItineraryCandidate } from "@/domain/itinerary";
import type { DayActivity } from "@/domain/meal-planning";
import { scheduleAvailableDay } from "@/domain/meal-planning";
import { source, route } from "./draft";

export function fixtureBrief(): TripBrief {
  return {
    destinationCity: "测试城市",
    originCity: null,
    startDate: "2026-11-01",
    dayCount: 2,
    travelers: 2,
    budget: {
      amountFen: 150000,
      basis: "per_person",
      includeIntercity: false,
      includeLodging: true,
    },
    availability: {
      firstDayStartMinute: 540,
      lastDayEndMinute: 1260,
      dailyStartMinute: 540,
      dailyEndMinute: 1260,
    },
    mainPurpose: "culture",
    secondaryPurposes: ["food"],
    pace: "balanced",
    mustVisit: [],
    mustEat: [],
    dietary: { avoid: [], allergies: [] },
  };
}
export function fixtureCandidates(): ItineraryCandidate[] {
  return [
    ...Array.from({ length: 42 }, (_, index) => ({
      kind: "visit" as const,
      query: "博物馆",
      place: {
        id: `full-visit-${index}`,
        name: `测试文化场馆${index + 1}`,
        address: `测试街区${index + 1}号`,
        citycode: "0571",
        location: [120.1 + index * 0.001, 30.2] as [number, number],
        openingHours: null,
        source: structuredClone(source),
      },
    })),
    ...["早餐", "午餐", "晚餐"].map((name, index) => ({
      kind: "restaurant" as const,
      query: "本地特色餐厅",
      place: {
        id: `full-food-${index}`,
        name: `测试${name}店`,
        address: `测试餐饮街${index + 1}号`,
        citycode: "0571",
        location: [120.11 + index * 0.001, 30.2] as [number, number],
        openingHours: null,
        source: structuredClone(source),
      },
    })),
  ];
}
export function fixtureOutline(brief = fixtureBrief()): ItineraryOutline {
  const food = (index: number) => ({
    placeId: `full-food-${index}`,
    reason: "AI 分析：与当天路线衔接，菜品供应需核实。",
    stayMinutes: 45,
    dish: `测试特色菜品${index + 1}`,
  });
  return {
    title: "在城市的文化与烟火之间",
    summary: "测试 fixture：用文化场馆串联街区，在三餐之间留出步行与休息的余地。",
    days: Array.from({ length: brief.dayCount }, (_, index) => ({
      theme: `文化与城市漫步 · 第${index + 1}天`,
      visits: [
        {
          placeId: `full-visit-${index * 2}`,
          reason: "AI 分析：以文化体验开启这一天。",
          stayMinutes: 60,
        },
        {
          placeId: `full-visit-${index * 2 + 1}`,
          reason: "AI 分析：下午继续体验当地生活。",
          stayMinutes: 60,
        },
      ],
      breakfast: food(0),
      lunch: food(1),
      dinner: food(2),
    })),
  };
}
export function fixtureItinerary(brief = fixtureBrief()): Itinerary {
  const outline = fixtureOutline(brief);
  const candidates = fixtureCandidates();
  const days = briefDays(brief).map((day, index) => {
    const recommendation = outline.days[index];
    const activities: DayActivity[] = [];
    const recommendations: Itinerary["days"][number]["recommendations"] = [];
    const add = (
      choice: (typeof recommendation.visits)[number],
      kind: DayActivity["kind"],
      window: DayActivity["window"],
      dish: string | null = null,
    ) => {
      const id = `activity:trip-${index}-${activities.length}`;
      activities.push({
        id,
        kind,
        place: structuredClone(
          candidates.find((item) => item.place.id === choice.placeId)!.place,
        ),
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
                source: { kind: "unverified", recordedAt: "2026-10-21T11:00:00Z" },
              },
      });
      recommendations.push({ activityId: id, reason: choice.reason, dish });
    };
    if (day.activityWindow) {
      for (const [kind, start, end, visitIndex] of [
        ["breakfast", 420, 600, 0],
        ["lunch", 660, 840, 1],
        ["dinner", 1020, 1260, -1],
      ] as const) {
        const window = {
          startMinute: Math.max(start, day.activityWindow.startMinute),
          endMinute: Math.min(end, day.activityWindow.endMinute),
        };
        if (window.endMinute - window.startMinute >= 45) {
          add(recommendation[kind], kind, window, recommendation[kind].dish);
        }
        if (visitIndex >= 0) {
          add(recommendation.visits[visitIndex], "visit", day.activityWindow);
        }
      }
    }
    const legs = activities.slice(1).map((activity, position) => ({
      fromActivityId: activities[position].id,
      toActivityId: activity.id,
      route: structuredClone(route),
    }));
    const schedule = day.activityWindow
      ? scheduleAvailableDay({
          date: day.date,
          timeZone: "Asia/Shanghai",
          startMinute: day.activityWindow.startMinute,
          endMinute: day.activityWindow.endMinute,
          bufferMinutes: 10,
          activities,
          legs,
        })
      : null;
    return {
      date: day.date,
      theme: recommendation.theme,
      schedule,
      recommendations,
      notices: day.activityWindow ? [] : ["该日没有可游玩时段。"],
    };
  });
  return {
    brief: structuredClone(brief),
    title: outline.title,
    summary: outline.summary,
    days,
    constraints: [],
    allocation: ["intercity", "local", "lodging", "meals", "tickets"].map((category) => ({
      category: category as Itinerary["allocation"][number]["category"],
      targetFen: category === "meals" ? briefBudget(brief).totalFen : 0,
    })),
    model: "fixture-model",
    generatedAt: "2026-10-21T11:00:00Z",
    fixture: true,
    status: days.some((day) => day.schedule?.status === "infeasible")
      ? "infeasible"
      : "unverified",
    notices: ["测试 fixture，非真实查询。预算图为目标分配建议，实际费用未知。"],
  };
}

import { describe, expect, it } from "vitest";
import type { AgentEvent, Place, Trip, TripRequest } from "@/lib/schema";
import { computeBudget } from "@/server/agent/enrich";
import { AgentSession } from "@/server/agent/session";
import { tools, toolSpecs } from "@/server/agent/tools";
import type { AmapClient, RouteResult } from "@/server/providers/amap";

const request: TripRequest = {
  city: "杭州",
  startDate: "2026-11-08",
  days: 2,
  travelers: 2,
  travelerType: "couple",
  budgetPerPerson: null,
  pace: "relaxed",
  interests: [],
  mustSee: "",
  foodPreference: "",
  notes: "",
  accessibility: false,
  arrivalTime: null,
  departureTime: null,
  hotelName: "",
};

function place(id: string, lng: number, extra: Partial<Place> = {}): Place {
  return {
    id,
    name: `地点${id}`,
    address: null,
    location: [lng, 30.25],
    type: null,
    rating: null,
    avgCost: null,
    openTime: null,
    photos: [],
    citycode: "0571",
    adcode: "330106",
    category: "sight",
    ...extra,
  };
}

/** 测试替身：不发网络请求，返回固定路线 */
const fakeAmap = {
  walking: async (): Promise<RouteResult> => ({
    minutes: 12,
    meters: 900,
    costCny: 0,
    path: [],
    summary: "步行",
  }),
  driving: async (): Promise<RouteResult> => ({
    minutes: 20,
    meters: 6000,
    costCny: 30,
    path: [],
    summary: "打车",
  }),
  transit: async (): Promise<RouteResult> => ({
    minutes: 35,
    meters: 6000,
    costCny: 3,
    path: [],
    summary: "地铁1号线",
  }),
} as unknown as AmapClient;

function session(withHotel = true, previous: Trip | null = null) {
  const events: AgentEvent[] = [];
  const s = new AgentSession(request, fakeAmap, (event) => events.push(event), previous);
  s.register([
    place("h1", 120.16, { category: "hotel", name: "测试酒店" }),
    place("s1", 120.15),
    place("s2", 120.155),
    place("r1", 120.152, { avgCost: 80 }),
    place("r2", 120.2, { avgCost: 120 }),
    place("s3", 120.3),
    place("s4", 120.31),
  ]);
  if (withHotel) {
    s.hotel = {
      place: s.places.get("h1")!,
      reason: "",
      pricePerNightCny: 300,
      userProvided: false,
    };
  }
  return { s, events };
}

const validDay = (day = 1, sights: [string, string] = ["s1", "s2"]) =>
  tools.save_day_plan.schema.parse({
    day,
    theme: "湖边",
    summary: "",
    stops: [
      stop(sights[0], "sight"),
      stop("r1", "meal", "lunch"),
      stop(sights[1], "sight"),
      stop("r2", "meal", "dinner"),
    ],
  });

const stop = (
  placeId: string,
  kind: "sight" | "meal",
  mealType: "lunch" | "dinner" | null = null,
) => ({
  placeId,
  kind,
  mealType,
  durationMin: kind === "meal" ? 60 : 90,
  title: placeId,
  description: "说明 https://bad.example",
  highlights: [],
  tips: [],
  ticketCny: kind === "sight" ? 50 : null,
  mealCny: null,
  dishes: [],
  citations: ["unknown-id"],
});

describe("agent tools", () => {
  it("exposes JSON schemas for function calling", () => {
    const specs = toolSpecs();
    expect(specs.map((spec) => spec.name)).toContain("save_day_plan");
    expect(specs.every((spec) => spec.parameters.type === "object")).toBe(true);
  });

  it("rejects places that did not come from a search", async () => {
    const { s } = session();
    const outcome = await tools.save_day_plan.run(
      tools.save_day_plan.schema.parse({
        day: 1,
        theme: "测试",
        summary: "",
        stops: [
          stop("fake", "sight"),
          stop("r1", "meal", "lunch"),
          stop("r2", "meal", "dinner"),
        ],
      }),
      s,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("不是检索结果中的真实地点");
  });

  it("requires lunch and dinner", async () => {
    const { s } = session();
    const outcome = await tools.save_day_plan.run(
      tools.save_day_plan.schema.parse({
        day: 1,
        theme: "测试",
        summary: "",
        stops: [stop("s1", "sight"), stop("s2", "sight")],
      }),
      s,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("午餐");
  });

  it("schedules a valid day with real legs, sanitizes text and drops unknown citations", async () => {
    const { s, events } = session();
    const outcome = await tools.save_day_plan.run(
      tools.save_day_plan.schema.parse({
        day: 1,
        theme: "湖边",
        summary: "",
        stops: [
          stop("s1", "sight"),
          stop("r1", "meal", "lunch"),
          stop("s2", "sight"),
          stop("r2", "meal", "dinner"),
        ],
      }),
      s,
    );
    expect(outcome.ok).toBe(true);
    const day = s.days.get(1)!;
    expect(day.legs).toHaveLength(3);
    expect(day.legs[0].mode).toBe("walking");
    expect(day.stops[0].description).not.toContain("http");
    expect(day.stops[0].citations).toEqual([]);
    expect(day.stops[1].mealCny).toBe(80);
    expect(events.some((event) => event.type === "day")).toBe(true);
  });

  it("requires a hotel before planning multi-day trips", async () => {
    const { s } = session(false);
    const outcome = await tools.save_day_plan.run(validDay(), s);
    expect(outcome.content).toContain("set_hotel");
  });

  it("adds hotel legs except after the last day", async () => {
    const { s } = session();
    await tools.save_day_plan.run(validDay(1), s);
    await tools.save_day_plan.run(validDay(2, ["s3", "s4"]), s);
    expect(s.days.get(1)!.startLeg).not.toBeNull();
    expect(s.days.get(1)!.endLeg).not.toBeNull();
    expect(s.days.get(2)!.endLeg).toBeNull();
  });

  it("keeps stops the user locked when revising", async () => {
    const { s } = session();
    await tools.save_day_plan.run(validDay(1), s);
    await tools.save_day_plan.run(validDay(2, ["s3", "s4"]), s);
    const locked = s.days.get(1)!;
    const previous = {
      days: [
        {
          ...locked,
          stops: locked.stops.map((item, i) => ({ ...item, locked: i === 0 })),
        },
      ],
      citations: [],
      candidates: [],
      hotel: s.hotel,
    } as unknown as Trip;
    const revise = session(true, previous).s;
    const outcome = await tools.save_day_plan.run(
      tools.save_day_plan.schema.parse({
        day: 1,
        theme: "改",
        summary: "",
        stops: [
          stop("s2", "sight"),
          stop("r1", "meal", "lunch"),
          stop("r2", "meal", "dinner"),
        ],
      }),
      revise,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("锁定");
  });

  it("refuses to finalize before every day is planned", async () => {
    const { s } = session();
    const outcome = await tools.finalize_trip.run(
      tools.finalize_trip.schema.parse({ title: "t", subtitle: "", overview: "" }),
      s,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("第 1、2 天");
  });
});

describe("budget", () => {
  it("keeps unknown costs out of the total instead of treating them as zero", () => {
    const budget = computeBudget([], 3, null, "");
    expect(budget.hotel).toBe(0);
    expect(budget.total).toBe(0);
  });

  it("splits hotel rooms per person", () => {
    const day = {
      day: 1,
      date: "2026-11-08",
      theme: "",
      summary: "",
      stops: [],
      legs: [],
      weather: null,
      warnings: [],
      startLeg: null,
      endLeg: null,
    };
    const budget = computeBudget(
      [day, { ...day, day: 2 }, { ...day, day: 3 }],
      3,
      400,
      "",
    );
    // 2 晚 × 2 间 × 400 / 3 人
    expect(budget.hotel).toBe(533);
  });
});

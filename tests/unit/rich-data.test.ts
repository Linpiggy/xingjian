import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, Place, Train, TripRequest } from "@/lib/schema";
import { computeBudget, trainFare } from "@/server/agent/enrich";
import { AgentSession } from "@/server/agent/session";
import { tools } from "@/server/agent/tools";
import {
  groupSeats,
  parseSignatureDishes,
  type AmapClient,
} from "@/server/providers/amap";
import { isOfficialSource, webSearch } from "@/server/providers/websearch";

const request: TripRequest = {
  city: "杭州",
  startDate: "2026-11-21",
  days: 2,
  travelers: 2,
  travelerType: "couple",
  budgetPerPerson: null,
  pace: "balanced",
  interests: [],
  mustSee: "",
  foodPreference: "",
  notes: "",
  accessibility: false,
  arrivalTime: null,
  departureTime: null,
  hotelName: "",
  origin: "上海",
};

const train = (trip: string, depart: string, arrive: string): Omit<Train, "date"> => ({
  trip,
  type: "G字头的高铁火车",
  from: "上海虹桥",
  to: "杭州东",
  depart,
  arrive,
  arriveNextDay: false,
  minutes: 45,
  seats: [
    { name: "二等座", price: 74, maxPrice: 83 },
    { name: "一等座", price: 119, maxPrice: 126 },
  ],
  doorToDoorMinutes: 80,
});

function station(name: string, citycode: string): Place {
  return {
    id: name,
    name,
    address: null,
    location: [120.2, 30.29],
    type: "火车站",
    rating: null,
    avgCost: null,
    openTime: null,
    photos: [],
    citycode,
    adcode: null,
    category: "other",
    signatureDishes: [],
    tel: null,
  };
}

const fakeAmap = {
  searchText: async (city: string) => [
    station(`${city}站`, city === "上海" ? "021" : "0571"),
  ],
  railOptions: async () => [
    train("G225", "09:00", "09:45"),
    train("G7639", "21:12", "22:12"),
  ],
} as unknown as AmapClient;

describe("高德数据解析", () => {
  it("提取招牌菜并过滤泛化标签", () => {
    expect(
      parseSignatureDishes("东坡肉,精品西湖醋鱼,特色菜,鸡肉,单人餐,东坡肉,龙井虾仁"),
    ).toEqual(["东坡肉", "西湖醋鱼", "龙井虾仁"]);
    expect(parseSignatureDishes(null)).toEqual([]);
  });

  it("同一席别合并为价格区间，无座排在最后", () => {
    expect(
      groupSeats([
        { name: "无座", price: 74 },
        { name: "二等座", price: 78 },
        { name: "二等座", price: 74 },
        { name: "一等座", price: 126 },
      ]),
    ).toEqual([
      { name: "二等座", price: 74, maxPrice: 78 },
      { name: "一等座", price: 126, maxPrice: 126 },
      { name: "无座", price: 74, maxPrice: 74 },
    ]);
  });
});

describe("往返车次", () => {
  it("预算按二等座最高档计入往返车票", () => {
    const outbound = { ...train("G225", "09:00", "09:45"), date: "2026-11-21" };
    expect(trainFare(outbound)).toBe(83);
    const budget = computeBudget([], 2, null, "", {
      origin: "上海",
      outbound,
      inbound: { ...outbound, trip: "G7360" },
      note: "",
      arrivalStation: null,
      departureStation: null,
    });
    expect(budget.intercity).toBe(166);
    expect(budget.total).toBe(166);
  });

  it("填了出发城市时，必须先选定车次才能提交每天安排", async () => {
    const session = new AgentSession(request, fakeAmap, () => undefined);
    session.register([
      { ...station("西湖", "0571"), category: "sight" },
      { ...station("楼外楼", "0571"), category: "food" },
      { ...station("知味观", "0571"), category: "food" },
    ]);
    const stop = (
      placeId: string,
      kind: "sight" | "meal",
      mealType: "lunch" | "dinner" | null,
    ) => ({
      placeId,
      kind,
      mealType,
      durationMin: 60,
      title: placeId,
      description: "",
    });
    const outcome = await tools.save_day_plan.run(
      tools.save_day_plan.schema.parse({
        day: 1,
        theme: "湖边",
        summary: "",
        stops: [
          stop("西湖", "sight", null),
          stop("楼外楼", "meal", "lunch"),
          stop("知味观", "meal", "dinner"),
        ],
      }),
      session,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("search_trains");
  });

  it("查询车次后只能从候选中选择，选定后约束第一天到达与最后一天离开", async () => {
    const events: AgentEvent[] = [];
    const session = new AgentSession(request, fakeAmap, (event) => events.push(event));
    const search = await tools.search_trains.run(
      { direction: "outbound", earliest: "07:00" },
      session,
    );
    expect(search.ok).toBe(true);
    expect(search.content).toContain("out-G225");

    const bad = await tools.set_trains.run(
      { outboundId: "out-G9999", returnId: null, note: "" },
      session,
    );
    expect(bad.ok).toBe(false);

    await tools.search_trains.run({ direction: "return", earliest: "13:00" }, session);
    const good = await tools.set_trains.run(
      { outboundId: "out-G225", returnId: "ret-G7639", note: "上午到、晚上走" },
      session,
    );
    expect(good.ok).toBe(true);
    expect(session.effectiveArrival()).toBe("09:45");
    expect(session.effectiveDeparture()).toBe("21:12");
  });

  it("没有出发城市时不查询车次", async () => {
    const session = new AgentSession(
      { ...request, origin: "" },
      fakeAmap,
      () => undefined,
    );
    const outcome = await tools.search_trains.run(
      { direction: "outbound", earliest: "07:00" },
      session,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("门票联网核对", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("按域名与标题判断官方来源", () => {
    expect(isOfficialSource("https://www.hangzhou.gov.cn/art/1.html", "门票公告")).toBe(
      true,
    );
    expect(isOfficialSource("https://www.dpm.org.cn/visit.html", "参观须知")).toBe(true);
    expect(isOfficialSource("https://you.ctrip.com/sight/1.html", "灵隐寺官网门票")).toBe(
      false,
    );
    expect(isOfficialSource("https://www.lingyinsi.org/ticket", "灵隐寺官方网站")).toBe(
      true,
    );
    expect(isOfficialSource("https://example.com/a", "攻略")).toBe(false);
  });

  it("未配置密钥时工具明确失败，门票回退为估算", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const session = new AgentSession(request, fakeAmap, () => undefined);
    session.register([{ ...station("灵隐寺", "0571"), category: "sight" }]);
    const outcome = await tools.verify_ticket.run({ placeId: "灵隐寺" }, session);
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("估算");
  });

  it("搜索结果官方来源排前，并只登记可引用的来源", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "灵隐寺门票攻略",
              url: "https://you.ctrip.com/x",
              content: "门票 75 元",
            },
            {
              title: "飞来峰景区票价",
              url: "https://www.hzwestlake.gov.cn/y",
              content: "飞来峰 45 元",
            },
          ],
        }),
      ),
    );
    const results = await webSearch("灵隐寺 门票");
    expect(results[0].official).toBe(true);
    const session = new AgentSession(request, fakeAmap, () => undefined);
    session.register([{ ...station("灵隐寺", "0571"), category: "sight" }]);
    const outcome = await tools.verify_ticket.run({ placeId: "灵隐寺" }, session);
    expect(outcome.ok).toBe(true);
    expect(session.verifiedSources.get("S1")?.official).toBe(true);
  });
});

/**
 * E2E 测试数据（人工编写的示例，非真实查询结果）：用于在无密钥环境下回放 Agent 事件流。
 */
import type { AgentEvent, Day, Place, Trip } from "@/lib/schema";

const place = (id: string, name: string, lng: number, lat: number): Place => ({
  id,
  name,
  address: "测试地址",
  location: [lng, lat],
  type: "风景名胜",
  rating: 4.6,
  avgCost: null,
  openTime: "08:00-17:30",
  photos: [],
  citycode: "0571",
  adcode: "330106",
  category: "sight",
  signatureDishes: [],
  tel: null,
});

const lake = place("T1", "测试湖畔", 120.15, 30.25);
const noodle = place("T2", "测试面馆", 120.155, 30.252);
const museum = place("T3", "测试博物馆", 120.16, 30.26);
const restaurant = place("T4", "测试餐厅", 120.165, 30.255);

export function fixtureDay(day: number, museumTitle = "测试博物馆"): Day {
  return {
    day,
    date: day === 1 ? "2026-11-08" : "2026-11-09",
    theme: day === 1 ? "湖畔漫步" : "博物馆半日",
    summary: "测试用的当日概述。",
    weather: {
      date: "2026-11-08",
      dayWeather: "多云",
      nightWeather: "晴",
      high: 18,
      low: 10,
      wind: "东风 1-3级",
    },
    warnings: [],
    startLeg: null,
    endLeg: null,
    stops: [
      {
        kind: "sight",
        mealType: null,
        place: lake,
        start: "09:00",
        end: "10:30",
        durationMin: 90,
        title: "清晨湖畔",
        description: "沿湖散步看晨光。",
        highlights: ["晨光"],
        tips: ["早到人少"],
        ticketCny: 0,
        mealCny: null,
        dishes: [],
        citations: ["hz-overview"],
        warnings: [],
        ticketSource: null,
        locked: false,
        userEdited: false,
      },
      {
        kind: "meal",
        mealType: "lunch",
        place: noodle,
        start: "11:30",
        end: "12:30",
        durationMin: 60,
        title: "片儿川午餐",
        description: "一碗地道面条。",
        highlights: [],
        tips: [],
        ticketCny: null,
        mealCny: 35,
        dishes: ["片儿川"],
        citations: [],
        warnings: [],
        ticketSource: null,
        locked: false,
        userEdited: false,
      },
      {
        kind: "sight",
        mealType: null,
        place: museum,
        start: "13:00",
        end: "15:00",
        durationMin: 120,
        title: museumTitle,
        description: "看馆藏。",
        highlights: [],
        tips: [],
        ticketCny: null,
        mealCny: null,
        dishes: [],
        citations: [],
        warnings: ["闭园前仅剩 30 分钟，游览可能不完整"],
        ticketSource: null,
        locked: false,
        userEdited: false,
      },
      {
        kind: "meal",
        mealType: "dinner",
        place: restaurant,
        start: "17:30",
        end: "18:30",
        durationMin: 60,
        title: "杭帮菜晚餐",
        description: "尝东坡肉。",
        highlights: [],
        tips: [],
        ticketCny: null,
        mealCny: 90,
        dishes: ["东坡肉"],
        citations: [],
        warnings: [],
        ticketSource: null,
        locked: false,
        userEdited: false,
      },
    ],
    legs: [
      {
        mode: "walking",
        minutes: 10,
        meters: 700,
        costCny: 0,
        summary: "步行",
        path: [
          [120.15, 30.25],
          [120.155, 30.252],
        ],
        alternative: null,
      },
      {
        mode: "transit",
        minutes: 20,
        meters: 3000,
        costCny: 2,
        summary: "地铁1号线",
        path: [],
        alternative: "打车约 10 分钟",
      },
      {
        mode: "taxi",
        minutes: 8,
        meters: 2000,
        costCny: 8,
        summary: "打车约 8 分钟",
        path: [],
        alternative: null,
      },
    ],
  };
}

export function fixtureTrip(
  changeSummary: string | null = null,
  museumTitle?: string,
): Trip {
  return {
    title: "测试两日·湖与城",
    subtitle: "这是一份端到端测试用行程",
    city: "杭州",
    overview: "测试总览文字，描述两天的整体安排。",
    days: [fixtureDay(1, museumTitle), fixtureDay(2, museumTitle)],
    tips: [{ text: "测试贴士：提前预约。", citations: ["hz-overview"] }],
    packing: ["雨伞", "充电宝"],
    budget: {
      tickets: 0,
      meals: 250,
      transport: 20,
      hotel: 300,
      intercity: null,
      total: 570,
      unknownItems: ["2 处景点门票未知"],
      hotelNote: "1 晚 × 1 间（AI 参考价，非实时报价）",
    },
    citations: [
      {
        id: "hz-overview",
        title: "杭州：西湖片区怎么分区游",
        source: "行间编辑部整理",
        excerpt: "测试摘录",
      },
    ],
    changeSummary,
    generatedAt: "2026-11-07T12:00:00.000Z",
    hotel: null,
    intercity: null,
    candidates: [{ ...restaurant, id: "T5", name: "测试备选餐厅", category: "food" }],
  };
}

export function planEvents(): AgentEvent[] {
  return [
    { type: "status", message: "Agent 已启动，正在理解你的需求" },
    { type: "thought", delta: "先检索知识库。" },
    { type: "tool_call", id: "c1", name: "search_knowledge", label: "检索知识库：西湖" },
    { type: "tool_result", id: "c1", ok: true, summary: "命中 1 条" },
    {
      type: "tool_call",
      id: "c2",
      name: "save_day_plan",
      label: "编排第 1 天：湖畔漫步",
    },
    { type: "tool_result", id: "c2", ok: false, summary: "第 1 天未通过校验" },
    { type: "day", day: fixtureDay(1) },
    { type: "day", day: fixtureDay(2) },
    { type: "trip", trip: fixtureTrip() },
    { type: "done" },
  ];
}

export function reviseEvents(): AgentEvent[] {
  return [
    { type: "status", message: "正在理解调整要求" },
    {
      type: "tool_call",
      id: "r1",
      name: "save_day_plan",
      label: "编排第 2 天：博物馆半日",
    },
    { type: "tool_result", id: "r1", ok: true, summary: "已排程 4 站" },
    { type: "trip", trip: fixtureTrip("第二天换成了调整后的博物馆", "调整后的博物馆") },
    { type: "done" },
  ];
}

export const toNdjson = (events: AgentEvent[]) =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";

/**
 * 对照评测：同一需求分别交给“直接问大模型”（基线）与“行间 Agent”，用同一套检查打分。
 *
 * 检查项（全部基于高德实时数据，两组完全相同的方法）：
 * - 地点可核实率：站点名称能否在该城市的高德 POI 中找到
 * - 正餐覆盖率：每天是否同时安排了午餐与晚餐
 * - 交通不可行段：相邻两站间预留时间 < 真实交通耗时（≤1.3km 步行，否则驾车）
 * - 营业时间冲突：到达早于开门或离开晚于关门（仅统计能解析营业时间的地点）
 *
 * 运行：npm run evaluate（读取 .env.local，会真实调用模型与高德接口）
 * 输出：docs/evaluation.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { distanceMeters } from "@/lib/geo";
import {
  tripRequestSchema,
  type Coordinate,
  type Trip,
  type TripRequest,
} from "@/lib/schema";
import { parseOpenWindow, toMinutes } from "@/lib/time";
import { runAgent } from "@/server/agent/run-agent";
import { llmConfigFromEnv, streamCompletion } from "@/server/llm/client";
import { amapFromEnv, type AmapClient } from "@/server/providers/amap";

interface PlanStop {
  name: string;
  kind: "sight" | "meal";
  start: string;
  end: string;
}
interface NormalizedPlan {
  days: PlanStop[][];
}
interface Metrics {
  stops: number;
  verified: number;
  mealDays: number;
  days: number;
  transitions: number;
  infeasible: number;
  openingChecked: number;
  openingConflicts: number;
  seconds: number;
}

const CASES: { label: string; request: Partial<TripRequest> }[] = [
  {
    label: "杭州 2 天 · 情侣 · 必去灵隐寺",
    request: {
      city: "杭州",
      days: 2,
      travelerType: "couple",
      mustSee: "灵隐寺",
      interests: ["历史文化", "地道美食"],
    },
  },
  {
    label: "北京 3 天 · 亲子 · 轻松",
    request: {
      city: "北京",
      days: 3,
      travelerType: "family",
      pace: "relaxed",
      interests: ["历史文化", "亲子游乐"],
    },
  },
  {
    label: "重庆 2 天 · 朋友 · 紧凑 · 夜景",
    request: {
      city: "重庆",
      days: 2,
      travelerType: "friends",
      pace: "packed",
      interests: ["夜生活", "地道美食", "摄影出片"],
    },
  },
  {
    label: "青岛 2 天 · 长辈 · 知识库未覆盖城市",
    request: {
      city: "青岛",
      days: 2,
      travelerType: "elderly",
      pace: "relaxed",
      interests: ["自然风光", "地道美食"],
    },
  },
];

function loadEnv() {
  if (!existsSync(".env.local")) {
    return;
  }
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, index).trim()] ??= line.slice(index + 1).trim();
    }
  }
}

function buildRequest(partial: Partial<TripRequest>): TripRequest {
  return tripRequestSchema.parse({
    startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    travelers: 2,
    travelerType: "couple",
    budgetPerPerson: null,
    pace: "balanced",
    interests: [],
    mustSee: "",
    foodPreference: "",
    notes: "",
    accessibility: false,
    ...partial,
  });
}

/** 基线：同样的需求，直接让模型一次性输出 JSON 行程，不给任何工具 */
async function baseline(request: TripRequest): Promise<NormalizedPlan> {
  const result = await streamCompletion(llmConfigFromEnv(), {
    tools: [],
    jsonOutput: true,
    signal: new AbortController().signal,
    onText: () => undefined,
    messages: [
      {
        role: "system",
        content:
          '你是旅行规划助手。只输出 JSON：{"days":[{"stops":[{"name":"真实地点或餐厅全称","kind":"sight 或 meal","start":"HH:mm","end":"HH:mm"}]}]}。每天按时间顺序排列，包含景点与午餐、晚餐。',
      },
      {
        role: "user",
        content: `城市：${request.city}；${request.days} 天；同行：${request.travelerType}；节奏：${request.pace}；兴趣：${request.interests.join("、") || "综合"}；必去：${request.mustSee || "无"}。`,
      },
    ],
  });
  const data = JSON.parse(result.content) as { days?: { stops?: PlanStop[] }[] };
  return { days: (data.days ?? []).map((day) => day.stops ?? []) };
}

async function agent(
  request: TripRequest,
): Promise<{ plan: NormalizedPlan; trip: Trip; toolCalls: number }> {
  let trip: Trip | null = null;
  let toolCalls = 0;
  await runAgent(
    { mode: "plan", request },
    (event) => {
      if (event.type === "trip") {
        trip = event.trip;
      } else if (event.type === "tool_call") {
        toolCalls += 1;
      }
    },
    new AbortController().signal,
  );
  if (!trip) {
    throw new Error("Agent 未完成");
  }
  const finished: Trip = trip;
  return {
    trip: finished,
    toolCalls,
    plan: {
      days: finished.days.map((day) =>
        day.stops.map((stop) => ({
          name: stop.place.name,
          kind: stop.kind === "meal" ? "meal" : "sight",
          start: stop.start,
          end: stop.end,
        })),
      ),
    },
  };
}

const normalize = (name: string) => name.replace(/[（(].*?[）)]/g, "").replace(/\s/g, "");

async function evaluate(
  amap: AmapClient,
  city: string,
  plan: NormalizedPlan,
  seconds: number,
): Promise<Metrics> {
  const metrics: Metrics = {
    stops: 0,
    verified: 0,
    mealDays: 0,
    days: plan.days.length,
    transitions: 0,
    infeasible: 0,
    openingChecked: 0,
    openingConflicts: 0,
    seconds,
  };
  for (const stops of plan.days) {
    const meals = stops
      .filter((stop) => stop.kind === "meal")
      .map((stop) => toMinutes(stop.start) ?? -1);
    const lunch = meals.some((time) => time >= 630 && time <= 870);
    const dinner = meals.some((time) => time >= 990 && time <= 1290);
    if (lunch && dinner) {
      metrics.mealDays += 1;
    }
    const located: ({ location: Coordinate; openTime: string | null } | null)[] = [];
    for (const stop of stops) {
      metrics.stops += 1;
      const results = await amap.searchText(city, stop.name, 3).catch(() => []);
      const target = normalize(stop.name);
      const match = results.find((place) => {
        const name = normalize(place.name);
        return name.includes(target) || target.includes(name);
      });
      if (match) {
        metrics.verified += 1;
        located.push({ location: match.location, openTime: match.openTime });
        const window = parseOpenWindow(match.openTime);
        const start = toMinutes(stop.start);
        const end = toMinutes(stop.end);
        if (window && start !== null && end !== null) {
          metrics.openingChecked += 1;
          if (start < window.open || end > window.close) {
            metrics.openingConflicts += 1;
          }
        }
      } else {
        located.push(null);
      }
    }
    for (let i = 1; i < stops.length; i += 1) {
      const from = located[i - 1];
      const to = located[i];
      const gap = (toMinutes(stops[i].start) ?? 0) - (toMinutes(stops[i - 1].end) ?? 0);
      if (!from || !to) {
        continue;
      }
      metrics.transitions += 1;
      const meters = distanceMeters(from.location, to.location);
      const route = await (
        meters <= 1300
          ? amap.walking(from.location, to.location)
          : amap.driving(from.location, to.location)
      ).catch(() => null);
      if (route?.minutes != null && gap < route.minutes) {
        metrics.infeasible += 1;
      }
    }
  }
  return metrics;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function row(label: string, m: Metrics, extra = "") {
  return `| ${label} | ${pct(m.verified, m.stops)}（${m.verified}/${m.stops}） | ${pct(m.mealDays, m.days)} | ${m.infeasible}/${m.transitions} | ${m.openingConflicts}/${m.openingChecked} | ${Math.round(m.seconds)} s${extra} |`;
}

async function main() {
  loadEnv();
  const amap = amapFromEnv();
  const lines: string[] = [];
  const totals = { baseline: [] as Metrics[], agent: [] as Metrics[] };

  for (const item of CASES) {
    const request = buildRequest(item.request);
    console.error(`== ${item.label}`);
    let t0 = Date.now();
    const base = await baseline(request);
    const baseMetrics = await evaluate(
      amap,
      request.city,
      base,
      (Date.now() - t0) / 1000,
    );
    t0 = Date.now();
    const result = await agent(request);
    const agentMetrics = await evaluate(
      amap,
      request.city,
      result.plan,
      (Date.now() - t0) / 1000,
    );
    totals.baseline.push(baseMetrics);
    totals.agent.push(agentMetrics);
    lines.push(
      `### ${item.label}`,
      "",
      "| 方案 | 地点可核实率 | 正餐覆盖率 | 交通不可行段 | 营业时间冲突 | 耗时 |",
      "| --- | --- | --- | --- | --- | --- |",
      row("直接问大模型", baseMetrics),
      row("行间 Agent", agentMetrics, ` · ${result.toolCalls} 次工具调用`),
      "",
    );
    console.error(lines.slice(-4).join("\n"));
  }

  const sum = (list: Metrics[]): Metrics =>
    list.reduce(
      (acc, m) => ({
        stops: acc.stops + m.stops,
        verified: acc.verified + m.verified,
        mealDays: acc.mealDays + m.mealDays,
        days: acc.days + m.days,
        transitions: acc.transitions + m.transitions,
        infeasible: acc.infeasible + m.infeasible,
        openingChecked: acc.openingChecked + m.openingChecked,
        openingConflicts: acc.openingConflicts + m.openingConflicts,
        seconds: acc.seconds + m.seconds / list.length,
      }),
      {
        stops: 0,
        verified: 0,
        mealDays: 0,
        days: 0,
        transitions: 0,
        infeasible: 0,
        openingChecked: 0,
        openingConflicts: 0,
        seconds: 0,
      },
    );

  const model = process.env.OPENAI_MODEL || "deepseek-flash";
  const doc = [
    "# 对照评测：直接问大模型 vs 行间 Agent",
    "",
    `评测时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}；模型：${model}（两组相同）；用例 ${CASES.length} 个。由 \`npm run evaluate\` 自动生成。`,
    "",
    "两组使用完全相同的检查方法，全部基于高德实时数据：",
    "",
    "- **地点可核实率**：站点名称能否在该城市的高德 POI 搜索结果中找到（名称互相包含即算）。",
    "- **正餐覆盖率**：每天是否同时安排了午餐（10:30–14:30 开始）与晚餐（16:30–21:30 开始）。",
    "- **交通不可行段**：相邻两站之间预留的时间少于真实交通耗时（1.3 km 内按步行，否则按驾车）的段数 / 可核实的相邻段数。",
    "- **营业时间冲突**：到达早于开门或离开晚于关门的站点数 / 能解析营业时间的站点数。",
    "",
    "## 汇总",
    "",
    "| 方案 | 地点可核实率 | 正餐覆盖率 | 交通不可行段 | 营业时间冲突 | 平均耗时 |",
    "| --- | --- | --- | --- | --- | --- |",
    row("直接问大模型", sum(totals.baseline)),
    row("行间 Agent", sum(totals.agent)),
    "",
    "## 分用例结果",
    "",
    ...lines,
    "## 说明",
    "",
    "- 名称匹配是近似检查：基线给出的泛称（如“西湖边”）或 Agent 选中的子景点名可能与搜索首页结果名称不完全一致，两组同样受影响。",
    "- 营业时间只取高德返回文本中的第一段时间，季节性、分时段的营业规则会被简化。",
    "- 样本量小，结果用于说明方法差异，不代表统计显著性；模型输出有随机性，重复运行数值会有波动。",
    "",
  ].join("\n");
  writeFileSync("docs/evaluation.md", doc, "utf8");
  console.error("written docs/evaluation.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

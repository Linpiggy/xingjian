/**
 * 行间 MCP Server（stdio 传输，Model Context Protocol）。
 * 把行间的知识库检索、高德地点/周边/天气查询和完整的旅行规划 Agent 暴露为 MCP 工具，
 * 供 Claude Desktop、Cursor 等支持 MCP 的客户端直接调用。
 *
 * 运行：npx tsx scripts/mcp-server.ts（工作目录为项目根目录，读取 .env.local）
 * 协议：每行一条 JSON-RPC 2.0 消息；stdout 只输出协议消息，日志写 stderr。
 */
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { tripToMarkdown } from "@/lib/format";
import { tripRequestSchema, type Trip } from "@/lib/schema";
import { addDays, todayInShanghai } from "@/lib/time";
import { runAgent } from "@/server/agent/run-agent";
import { amapFromEnv, parseLocation } from "@/server/providers/amap";
import { hasCityKnowledge, retrieve } from "@/server/rag/retriever";

const PROTOCOL_VERSION = "2025-06-18";

function loadEnv() {
  if (!existsSync(".env.local")) {
    return;
  }
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.trim().startsWith("#")) {
      const key = line.slice(0, index).trim();
      process.env[key] ??= line.slice(index + 1).trim();
    }
  }
}

const log = (...args: unknown[]) => console.error("[xingjian-mcp]", ...args);

interface McpTool {
  description: string;
  schema: z.ZodType;
  run: (args: never) => Promise<string>;
}

function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  run: (args: z.infer<T>) => Promise<string>,
): McpTool {
  return { description, schema, run: run as (args: never) => Promise<string> };
}

const tools: Record<string, McpTool> = {
  search_travel_knowledge: tool(
    "检索行间旅行知识库（RAG）：目的地分区玩法、美食、预约政策、季节与出行注意事项。",
    z.object({
      city: z.string().describe("城市，如 杭州"),
      query: z.string().describe("想了解的问题，如 灵隐寺 门票"),
    }),
    async ({ city, query }) => {
      const hits = retrieve(query, city, 5);
      return JSON.stringify(
        {
          cityCovered: hasCityKnowledge(city),
          results: hits.map((hit) => ({
            id: hit.id,
            title: hit.title,
            content: hit.content,
          })),
        },
        null,
        2,
      );
    },
  ),
  search_places: tool(
    "用高德地图在指定城市搜索真实地点（景点、餐厅、酒店等），返回评分、营业时间、坐标。",
    z.object({
      city: z.string(),
      keyword: z.string().describe("地点名称或类别，如 博物馆"),
    }),
    async ({ city, keyword }) => {
      const places = await amapFromEnv().searchText(city, keyword);
      return JSON.stringify(
        places.map((place) => ({
          id: place.id,
          name: place.name,
          category: place.category,
          type: place.type,
          rating: place.rating,
          avgCost: place.avgCost,
          openTime: place.openTime,
          address: place.address,
          lnglat: place.location.join(","),
        })),
        null,
        2,
      );
    },
  ),
  search_nearby: tool(
    "以坐标为中心，用高德搜索周边的餐厅、咖啡馆、酒店等。",
    z.object({
      lnglat: z.string().describe("经度,纬度（GCJ-02），可取自 search_places 结果"),
      keyword: z.string(),
      radius: z.number().int().min(200).max(5000).default(1500),
    }),
    async ({ lnglat, keyword, radius }) => {
      const center = parseLocation(lnglat);
      if (!center) {
        throw new Error("lnglat 格式应为“经度,纬度”");
      }
      const places = await amapFromEnv().searchAround(center, keyword, radius);
      return JSON.stringify(
        places.map((place) => ({
          name: place.name,
          type: place.type,
          rating: place.rating,
          avgCost: place.avgCost,
          openTime: place.openTime,
          lnglat: place.location.join(","),
        })),
        null,
        2,
      );
    },
  ),
  get_weather: tool(
    "查询城市未来 4 天天气预报（高德）。",
    z.object({ city: z.string() }),
    async ({ city }) => {
      const amap = amapFromEnv();
      const [place] = await amap.searchText(city, city, 1);
      if (!place?.adcode) {
        throw new Error("无法识别城市");
      }
      return JSON.stringify(await amap.weather(place.adcode), null, 2);
    },
  ),
  plan_trip: tool(
    "调用行间旅行规划 Agent 生成完整多日行程（景点、三餐、住宿、真实交通与时刻、预算），返回 Markdown 手册。耗时约 1 分钟。",
    z.object({
      city: z.string(),
      days: z.number().int().min(1).max(7),
      startDate: z.string().optional().describe("YYYY-MM-DD，默认明天"),
      travelers: z.number().int().min(1).max(20).default(2),
      travelerType: z
        .enum(["solo", "couple", "friends", "family", "elderly"])
        .default("couple"),
      pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
      budgetPerPerson: z.number().int().nullable().default(null),
      interests: z.array(z.string()).default([]),
      mustSee: z.string().default(""),
      foodPreference: z.string().default(""),
      notes: z.string().default(""),
      arrivalTime: z.string().nullable().default(null),
      departureTime: z.string().nullable().default(null),
    }),
    async (args) => {
      const request = tripRequestSchema.parse({
        ...args,
        startDate: args.startDate ?? addDays(todayInShanghai(), 1),
        interests: args.interests.filter((item) =>
          (
            tripRequestSchema.shape.interests.element.options as readonly string[]
          ).includes(item),
        ),
        accessibility: false,
        hotelName: "",
      });
      let trip: Trip | null = null;
      let failure: string | null = null;
      await runAgent(
        { mode: "plan", request },
        (event) => {
          if (event.type === "tool_call") {
            log(event.label);
          } else if (event.type === "trip") {
            trip = event.trip;
          } else if (event.type === "error") {
            failure = event.message;
          }
        },
        new AbortController().signal,
      );
      if (!trip) {
        throw new Error(failure ?? "规划未完成");
      }
      return tripToMarkdown(trip, request);
    },
  ),
};

type Message = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

function send(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(message: Message) {
  const { id, method, params } = message;
  const reply = (result: unknown) =>
    id !== undefined && send({ jsonrpc: "2.0", id, result });
  const error = (code: number, text: string) =>
    id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message: text } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: (params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "xingjian-travel", version: "0.2.0" },
        instructions:
          "行间旅行规划工具：先用 search_travel_knowledge / search_places 了解目的地，或直接用 plan_trip 生成完整行程。",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: Object.entries(tools).map(([name, item]) => ({
          name,
          description: item.description,
          inputSchema: z.toJSONSchema(item.schema, { io: "input" }),
        })),
      });
    case "tools/call": {
      const name = String(params?.name ?? "");
      const target = tools[name];
      if (!target) {
        return error(-32602, `未知工具：${name}`);
      }
      const parsed = target.schema.safeParse(params?.arguments ?? {});
      if (!parsed.success) {
        return reply({
          content: [
            { type: "text", text: `参数错误：${parsed.error.issues[0]?.message}` },
          ],
          isError: true,
        });
      }
      try {
        const text = await target.run(parsed.data as never);
        return reply({ content: [{ type: "text", text }] });
      } catch (cause) {
        return reply({
          content: [
            {
              type: "text",
              text: cause instanceof Error ? cause.message : "工具执行失败",
            },
          ],
          isError: true,
        });
      }
    }
    default:
      if (method.startsWith("notifications/")) {
        return;
      }
      return error(-32601, `不支持的方法：${method}`);
  }
}

function main() {
  loadEnv();
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    void handle(message).catch((cause) => log("unexpected", cause));
  });
  log("ready");
}

main();

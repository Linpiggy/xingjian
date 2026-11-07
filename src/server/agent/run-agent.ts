/**
 * Agent 主循环（ReAct 风格）：
 *   模型思考 → 调用工具（可并行）→ 观察结果 → 再思考 … → finalize_trip
 * 循环由服务端掌控：限制最大轮数、校验每个工具参数、捕获工具异常并反馈给模型自我修正。
 */
import type { AgentEvent, AgentInput } from "@/lib/schema";
import { AppError } from "@/server/errors";
import {
  assistantMessage,
  llmConfigFromEnv,
  streamCompletion,
  type ChatMessage,
  type ToolCall,
} from "@/server/llm/client";
import { amapFromEnv } from "@/server/providers/amap";
import { assertSafe, looksLikeInjection, userText } from "./guard";
import { planMessage, reviseMessage, SYSTEM_PROMPT } from "./prompts";
import { AgentSession } from "./session";
import { isToolName, tools, toolSpecs, type ToolOutcome } from "./tools";

const MAX_ROUNDS = 18;
const MAX_NUDGES = 2;

async function executeTool(call: ToolCall, session: AgentSession): Promise<ToolOutcome> {
  if (!isToolName(call.name)) {
    return {
      ok: false,
      content: JSON.stringify({ error: `不存在工具 ${call.name}` }),
      summary: "未知工具",
    };
  }
  const tool = tools[call.name];
  let raw: unknown;
  try {
    raw = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return {
      ok: false,
      content: JSON.stringify({ error: "参数不是合法 JSON，请重新调用" }),
      summary: "参数格式错误，已要求模型重试",
    };
  }
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "参数"}：${issue.message}`)
      .join("；");
    return {
      ok: false,
      content: JSON.stringify({ error: `参数校验失败：${issues}` }),
      summary: "参数未通过校验，已要求模型修正",
    };
  }
  try {
    // 每个工具的 run 与自身 schema 配套，这里经 safeParse 后类型安全
    return await (tool.run as (args: unknown, s: AgentSession) => Promise<ToolOutcome>)(
      parsed.data,
      session,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "工具执行失败";
    return { ok: false, content: JSON.stringify({ error: message }), summary: message };
  }
}

function labelOf(call: ToolCall, session: AgentSession): string {
  if (!isToolName(call.name)) {
    return call.name;
  }
  try {
    const tool = tools[call.name];
    const parsed = tool.schema.safeParse(JSON.parse(call.arguments || "{}"));
    if (parsed.success) {
      return (tool.label as (args: unknown, s: AgentSession) => string)(
        parsed.data,
        session,
      );
    }
  } catch {
    // 参数不完整时退回工具名
  }
  return call.name;
}

export async function runAgent(
  input: AgentInput,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const extra = input.mode === "revise" ? input.instruction : "";
  const text = userText(input.request, extra);
  assertSafe(`${input.request.city}\n${text}`);
  const injection = looksLikeInjection(text);
  const llm = llmConfigFromEnv();
  const amap = amapFromEnv();
  const session = new AgentSession(
    input.request,
    amap,
    emit,
    input.mode === "revise" ? input.trip : null,
  );

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        input.mode === "plan"
          ? planMessage(input.request, injection)
          : reviseMessage(input.request, input.trip, input.instruction, injection),
    },
  ];
  emit({
    type: "status",
    message:
      input.mode === "plan" ? "Agent 已启动，正在理解你的需求" : "正在理解调整要求",
  });

  const specs = toolSpecs();
  let nudges = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (signal.aborted) {
      return;
    }
    const result = await streamCompletion(llm, {
      messages,
      tools: specs,
      signal,
      onText: (delta) => emit({ type: "thought", delta }),
    });
    messages.push(assistantMessage(result));
    if (result.content) {
      emit({ type: "thought", delta: "\n" });
    }

    if (!result.toolCalls.length) {
      if (session.finalTrip) {
        break;
      }
      if (result.finishReason === "length") {
        throw new AppError("ai_invalid", "模型输出被截断，请减少天数后重试");
      }
      if (nudges >= MAX_NUDGES) {
        throw new AppError("ai_invalid", "模型未能完成规划，请稍后重试");
      }
      nudges += 1;
      messages.push({
        role: "user",
        content:
          "请继续通过工具完成规划：提交所有天的 save_day_plan，然后调用 finalize_trip。",
      });
      continue;
    }

    for (const call of result.toolCalls) {
      emit({
        type: "tool_call",
        id: call.id,
        name: call.name,
        label: labelOf(call, session),
      });
    }
    // 只读检索类工具可以并行；save_day_plan 内部的高德调用会自动串行节流
    const outcomes = await Promise.all(
      result.toolCalls.map((call) => executeTool(call, session)),
    );
    result.toolCalls.forEach((call, i) => {
      const outcome = outcomes[i];
      emit({
        type: "tool_result",
        id: call.id,
        ok: outcome.ok,
        summary: outcome.summary,
        ...(outcome.places ? { places: outcome.places } : {}),
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
    });

    if (session.finalTrip) {
      emit({ type: "trip", trip: session.finalTrip });
      return;
    }
  }

  if (session.finalTrip) {
    emit({ type: "trip", trip: session.finalTrip });
    return;
  }
  throw new AppError("ai_invalid", "规划步骤超出上限，请简化需求后重试");
}

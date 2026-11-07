/**
 * OpenAI 兼容 Chat Completions 客户端（默认 DeepSeek），支持流式输出与 Function Calling。
 * 只用原生 fetch + SSE 解析，便于逐 token 把“思考说明”推给前端，同时拼装分片到达的 tool_calls。
 */
import { AppError } from "@/server/errors";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface RawToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface LlmConfig {
  endpoint: URL;
  key: string;
  model: string;
  isDeepSeek: boolean;
}

export function llmConfigFromEnv(): LlmConfig {
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new AppError(
      "not_configured",
      "服务端未配置大模型密钥（DEEPSEEK_API_KEY 或 OPENAI_API_KEY）",
    );
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.deepseek.com";
  const model = process.env.OPENAI_MODEL || "deepseek-flash";
  const endpoint = new URL(base);
  if (
    endpoint.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(endpoint.hostname)
  ) {
    throw new AppError("not_configured", "模型服务地址必须使用 HTTPS");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/chat/completions`;
  return { endpoint, key, model, isDeepSeek: endpoint.hostname === "api.deepseek.com" };
}

export async function streamCompletion(
  config: LlmConfig,
  options: {
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
    onText: (delta: string) => void;
    maxTokens?: number;
    /** 不使用工具时可要求模型只输出 JSON 对象 */
    jsonOutput?: boolean;
  },
): Promise<CompletionResult> {
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        temperature: 0.4,
        max_tokens: options.maxTokens ?? 8000,
        ...(config.isDeepSeek ? { thinking: { type: "disabled" } } : {}),
        messages: options.messages,
        ...(options.tools.length
          ? {
              tools: options.tools.map((tool) => ({ type: "function", function: tool })),
              tool_choice: "auto",
            }
          : {}),
        ...(options.jsonOutput ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (error) {
    if (options.signal.aborted) {
      throw error;
    }
    throw new AppError("upstream", "模型服务连接超时或网络异常");
  }
  if (!response.ok || !response.body) {
    const message =
      response.status === 401 || response.status === 403
        ? "模型密钥无效或无权限"
        : response.status === 402
          ? "模型账户余额不足"
          : response.status === 429
            ? "模型服务限流，请稍后再试"
            : `模型服务暂不可用（HTTP ${response.status}）`;
    throw new AppError(
      response.status === 429 ? "rate_limited" : "upstream",
      message,
      30,
    );
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let content = "";
  let finishReason = "";
  const calls = new Map<number, ToolCall>();

  const handle = (line: string) => {
    if (!line.startsWith("data:")) {
      return;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }
    let chunk: {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        finish_reason?: string | null;
      }[];
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    const choice = chunk.choices?.[0];
    if (!choice) {
      return;
    }
    if (choice.delta?.content) {
      content += choice.delta.content;
      options.onText(choice.delta.content);
    }
    for (const part of choice.delta?.tool_calls ?? []) {
      const current = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
      if (part.id) {
        current.id = part.id;
      }
      if (part.function?.name) {
        current.name += part.function.name;
      }
      if (part.function?.arguments) {
        current.arguments += part.function.arguments;
      }
      calls.set(part.index, current);
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handle(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handle(buffer.trim());

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    .filter((call) => call.name);
  return { content, toolCalls, finishReason };
}

export function assistantMessage(result: CompletionResult): ChatMessage {
  return {
    role: "assistant",
    content: result.content || null,
    ...(result.toolCalls.length
      ? {
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  };
}

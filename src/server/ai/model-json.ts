import { ProviderError } from "@/server/providers/errors";

export function jsonFailureSummary(error: SyntaxError) {
  // V8 messages may contain provider/model content. Never retain or print them.
  const message = error.message;
  return {
    category: /control character/i.test(message)
      ? "control_character"
      : /escape/i.test(message)
        ? "invalid_escape"
        : /end of JSON/i.test(message)
          ? "unexpected_end"
          : /property name/i.test(message)
            ? "property_name"
            : "syntax",
    offset: Number(/position (\d+)/i.exec(message)?.[1] ?? -1),
  };
}

export function rejectModelJson(
  error: SyntaxError,
  layer: "upstream" | "content",
): never {
  const summary = jsonFailureSummary(error);
  console.warn("[itinerary-json-rejected]", { layer, ...summary });
  throw new ProviderError(
    "unavailable",
    layer === "upstream"
      ? "模型服务返回的不是合法接口 JSON，尚未读取行程正文；原方案保留，不会自动重试。"
      : summary.category === "control_character" || summary.category === "invalid_escape"
        ? "模型行程正文存在字符串转义错误，未应用方案；原方案保留，不会自动重试。"
        : "模型行程正文不是完整合法 JSON，未应用方案；原方案保留，不会自动重试。",
    layer === "upstream" ? "ai_upstream_invalid_json" : "ai_invalid_json",
  );
}

export function parseModelEnvelope(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      rejectModelJson(error, "upstream");
    }
    throw error;
  }
}

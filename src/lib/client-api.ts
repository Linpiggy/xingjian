import type { ZodType } from "zod";

export async function requestJson<T>(
  url: string,
  schema: ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const timeout = AbortSignal.timeout(60_000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { ...options, signal });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : "请求失败，请稍后重试。";
    throw new Error(message);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error("服务响应格式异常，未使用无效数据。");
  }
  return parsed.data;
}

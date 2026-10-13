import { ProviderError } from "@/server/providers/errors";

export function modelConfig() {
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new ProviderError(
      "not_configured",
      "请在服务端环境配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。",
      "ai_not_configured",
    );
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.deepseek.com";
  const model = process.env.OPENAI_MODEL || "deepseek-flash";
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      model === key ||
      !/^[A-Za-z0-9._:/-]{1,96}$/.test(model)
    ) {
      throw new Error("Invalid server configuration");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
    return { key, endpoint: url, model };
  } catch {
    throw new ProviderError(
      "not_configured",
      "模型服务地址或模型名称配置无效。",
      "ai_not_configured",
    );
  }
}

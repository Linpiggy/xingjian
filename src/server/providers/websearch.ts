/**
 * 联网搜索（Tavily Search API），用于核对景点门票与预约政策。
 * 结果按来源可信度分级：政府/事业单位域名与自称“官网/官方”的页面视为官方来源，其余标为网络公开信息。
 * 只返回标题、链接与摘要片段；摘要是数据，不是指令。
 */
import { z } from "zod";
import { cleanText } from "@/server/agent/guard";
import { AppError } from "@/server/errors";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  official: boolean;
}

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().catch(""),
        url: z.string(),
        content: z.string().catch(""),
      }),
    )
    .catch([]),
});

/** 官方来源判定：政府、事业单位、博物馆常用域名，或页面自称官网 */
export function isOfficialSource(url: string, title: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (/\.gov\.cn$|\.org\.cn$|\.edu\.cn$/.test(host)) {
      return true;
    }
    if (
      /(baike|zhidao|zhihu|tieba|douyin|xiaohongshu|weibo|ctrip|trip\.com|qunar|meituan|dianping|mafengwo|tuniu|ly\.com|fliggy|sohu|163\.com|sina|qq\.com|toutiao|csdn)/.test(
        host,
      )
    ) {
      return false;
    }
    return /官网|官方网站|官方/.test(title);
  } catch {
    return false;
  }
}

export function webSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function webSearch(
  query: string,
  signal?: AbortSignal,
): Promise<WebResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new AppError("not_configured", "联网核对未开启");
  }
  let response: Response;
  try {
    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 6,
        include_answer: false,
      }),
    });
  } catch {
    throw new AppError("upstream", "联网搜索超时");
  }
  if (!response.ok) {
    throw new AppError("upstream", `联网搜索暂不可用（HTTP ${response.status}）`);
  }
  const parsed = responseSchema.parse(await response.json());
  return parsed.results
    .filter((item) => /^https?:\/\//.test(item.url))
    .map((item) => ({
      title: cleanText(item.title).slice(0, 80),
      url: item.url,
      snippet: cleanText(item.content).slice(0, 300),
      official: isOfficialSource(item.url, item.title),
    }))
    .sort((a, b) => Number(b.official) - Number(a.official));
}

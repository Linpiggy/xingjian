/**
 * 轻量 RAG 检索器：中文字符二元组（bigram）+ BM25 打分，城市过滤 + 通用知识补充。
 * 语料规模只有几十条，在内存里建倒排即可；无需外部向量库，结果可解释、可复现。
 */
import { corpus, KNOWLEDGE_SOURCE, type KnowledgeDoc } from "./corpus";

const K1 = 1.4;
const B = 0.75;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text
    .toLowerCase()
    .replace(/[\s，。、；：！？（）“”‘’,.;:!?()"'—\-]+/g, " ");
  for (const word of normalized.split(" ")) {
    if (!word) {
      continue;
    }
    if (/^[a-z0-9]+$/.test(word)) {
      tokens.push(word);
      continue;
    }
    const chars = [...word];
    if (chars.length === 1) {
      tokens.push(chars[0]);
    }
    for (let i = 0; i < chars.length - 1; i += 1) {
      tokens.push(chars[i] + chars[i + 1]);
    }
  }
  return tokens;
}

interface IndexedDoc {
  doc: KnowledgeDoc;
  terms: Map<string, number>;
  length: number;
}

function buildIndex(docs: KnowledgeDoc[]) {
  const indexed: IndexedDoc[] = docs.map((doc) => {
    // 标题与标签加权：重复一次进入词频
    const tokens = tokenize(
      `${doc.title} ${doc.title} ${doc.tags.join(" ")} ${doc.content}`,
    );
    const terms = new Map<string, number>();
    for (const token of tokens) {
      terms.set(token, (terms.get(token) ?? 0) + 1);
    }
    return { doc, terms, length: tokens.length };
  });
  const documentFrequency = new Map<string, number>();
  for (const item of indexed) {
    for (const term of item.terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const averageLength =
    indexed.reduce((sum, item) => sum + item.length, 0) / indexed.length;
  return { indexed, documentFrequency, averageLength, total: indexed.length };
}

const index = buildIndex(corpus);

export function normalizeCity(city: string): string {
  return city.trim().replace(/(特别行政区|自治州|地区|市)$/u, "");
}

export function hasCityKnowledge(city: string): boolean {
  const name = normalizeCity(city);
  return corpus.some((doc) => doc.city === name);
}

export interface RetrievedChunk {
  id: string;
  title: string;
  city: string | null;
  content: string;
  score: number;
  source: string;
}

export function retrieve(query: string, city: string, limit = 4): RetrievedChunk[] {
  const name = normalizeCity(city);
  const queryTerms = [...new Set(tokenize(`${query}`))];
  const scored = index.indexed
    .filter((item) => item.doc.city === null || item.doc.city === name)
    .map((item) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = item.terms.get(term);
        if (!frequency) {
          continue;
        }
        const df = index.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (index.total - df + 0.5) / (df + 0.5));
        score +=
          (idf * frequency * (K1 + 1)) /
          (frequency + K1 * (1 - B + (B * item.length) / index.averageLength));
      }
      // 同城知识优先于通用知识
      if (item.doc.city === name) {
        score *= 1.25;
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ item, score }) => ({
    id: item.doc.id,
    title: item.doc.title,
    city: item.doc.city,
    content: item.doc.content,
    score: Math.round(score * 100) / 100,
    source: KNOWLEDGE_SOURCE,
  }));
}

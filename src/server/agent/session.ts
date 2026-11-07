/**
 * 一次 Agent 运行的会话状态：候选地点注册表、已检索知识、天气与逐日草稿。
 * 模型只能引用注册表里的地点 ID，这是防止“幻觉地点”的核心约束。
 */
import type { AgentEvent, Day, Place, Trip, TripRequest, Weather } from "@/lib/schema";
import type { RetrievedChunk } from "@/server/rag/retriever";
import type { AmapClient } from "@/server/providers/amap";

export interface StopDraft {
  placeId: string;
  kind: "sight" | "meal" | "rest";
  mealType: "breakfast" | "lunch" | "dinner" | "snack" | null;
  durationMin: number;
  title: string;
  description: string;
  highlights: string[];
  tips: string[];
  ticketCny: number | null;
  mealCny: number | null;
  dishes: string[];
  citations: string[];
}

export interface DayDraft {
  day: number;
  theme: string;
  summary: string;
  stops: StopDraft[];
}

export class AgentSession {
  readonly places = new Map<string, Place>();
  readonly knowledge = new Map<string, RetrievedChunk>();
  readonly days = new Map<number, Day>();
  weather: Weather[] | null = null;
  finalTrip: Trip | null = null;
  amapCalls = 0;

  constructor(
    readonly request: TripRequest,
    readonly amap: AmapClient,
    readonly emit: (event: AgentEvent) => void,
    readonly previous: Trip | null = null,
  ) {
    if (previous) {
      for (const day of previous.days) {
        this.days.set(day.day, day);
        for (const stop of day.stops) {
          this.places.set(stop.place.id, stop.place);
        }
      }
      for (const citation of previous.citations) {
        this.knowledge.set(citation.id, {
          id: citation.id,
          title: citation.title,
          city: null,
          content: citation.excerpt,
          score: 0,
          source: citation.source,
        });
      }
    }
  }

  register(places: Place[]): void {
    for (const place of places) {
      this.places.set(place.id, place);
    }
  }
}

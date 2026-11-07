/**
 * 一次 Agent 运行的会话状态：候选地点注册表、已检索知识、天气、住宿与逐日结果。
 * 模型只能引用注册表里的地点 ID，这是防止“幻觉地点”的核心约束。
 */
import type {
  AgentEvent,
  Day,
  Hotel,
  Place,
  Trip,
  TripRequest,
  Weather,
} from "@/lib/schema";
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
  locked?: boolean;
  userEdited?: boolean;
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
  hotel: Hotel | null = null;
  /** 住宿变化后需要重算往返交通的天 */
  staleDays = new Set<number>();
  /** 每天的提交次数，用于防止反复重提 */
  readonly saveAttempts = new Map<number, number>();
  finalTrip: Trip | null = null;
  amapCalls = 0;

  constructor(
    readonly request: TripRequest,
    readonly amap: AmapClient,
    readonly emit: (event: AgentEvent) => void,
    readonly previous: Trip | null = null,
  ) {
    if (previous) {
      this.hotel = previous.hotel;
      if (previous.hotel) {
        this.places.set(previous.hotel.place.id, previous.hotel.place);
      }
      this.register(previous.candidates);
      for (const day of previous.days) {
        this.days.set(day.day, day);
        if (day.weather) {
          this.weather = [...(this.weather ?? []), day.weather];
        }
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

  /** 原行程中被用户锁定的站点（调整模式下必须保留） */
  lockedPlaceIds(day: number): string[] {
    const original = this.previous?.days.find((item) => item.day === day);
    return (
      original?.stops.filter((stop) => stop.locked).map((stop) => stop.place.id) ?? []
    );
  }

  needsHotel(): boolean {
    return this.request.days > 1;
  }
}

/**
 * 一次 Agent 运行的会话状态：候选地点注册表、已检索知识、天气、住宿与逐日结果。
 * 模型只能引用注册表里的地点 ID，这是防止“幻觉地点”的核心约束。
 */
import type {
  AgentEvent,
  Day,
  Hotel,
  Intercity,
  Place,
  Train,
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
  ticketSourceId?: string | null;
  /** 已核对过的来源（手动编辑重排时保留） */
  ticketSource?: {
    url: string;
    title: string;
    official: boolean;
    checkedAt: string;
  } | null;
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
  /** 选定的往返车次 */
  intercity: Intercity | null = null;
  /** search_trains 返回过的车次候选（模型只能从中选择） */
  readonly trainOptions = new Map<string, Train>();
  /** 城市火车站缓存（跨城查询用） */
  readonly stations = new Map<
    string,
    { location: Place["location"]; citycode: string } | null
  >();
  /** 联网核对门票时检索到的来源（模型只能引用其中的链接） */
  readonly verifiedSources = new Map<
    string,
    { url: string; title: string; official: boolean }
  >();
  /** 本次运行已联网核对门票的次数 */
  ticketChecks = 0;
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
      this.intercity = previous.intercity;
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

  /** 需要推荐往返车次：填了出发城市且不是目的地本身 */
  needsTrains(): boolean {
    const origin = this.request.origin.replace(/市$/, "");
    return Boolean(origin) && !this.request.city.includes(origin);
  }

  /** 第一天最早开始时间：优先取车次到达时间，其次取用户填写的抵达时间 */
  effectiveArrival(): string | null {
    return this.intercity?.outbound?.arrive ?? this.request.arrivalTime;
  }

  /** 最后一天必须离开的时间：优先取返程车次出发时间 */
  effectiveDeparture(): string | null {
    return this.intercity?.inbound?.depart ?? this.request.departureTime;
  }

  needsHotel(): boolean {
    return this.request.days > 1;
  }
}

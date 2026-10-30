import type { VenueRules } from "./meal-planning";

export type Coordinate = [number, number];
export type Source = (
  { kind: "provider" | "fixture"; provider: "amap" } | { kind: "user"; provider: "user" }
) & {
  queriedAt: string;
  coordinateSystem: "GCJ-02";
};
export type PlaceSelection =
  | { kind: "amap"; poiId: string; keyword: string }
  | { kind: "user"; id: string; name: string; location: Coordinate };
export type PlaceCandidate = { place: Place; selection: PlaceSelection };
export type Place = {
  id: string;
  name: string;
  address: string | null;
  citycode: string | null;
  location: Coordinate;
  openingHours: string | null;
  source: Source;
};
export type RouteMode = "walking" | "driving" | "transit";

/**
 * 一段接续路线。mode 是已查询到的交通方式，不是模型猜测；
 * detail 只写供应商返回的可核对信息（如“打车参考”），没有就为 null。
 */
export type Route = {
  mode: RouteMode;
  meters: number | null;
  seconds: number | null;
  segments: Coordinate[][];
  detail: string | null;
  source: Source;
};
export type TripInput = {
  city: string;
  startDate: string;
  dayCount: 2 | 3;
  travelers: number;
  budgetPerPersonFen: number;
  keywords: string[];
  selections?: PlaceSelection[];
  stayMinutes: number;
  bufferMinutes: number;
};
export type Leg = {
  fromId: string;
  toId: string;
  route: Route | null;
  error: string | null;
};
export type Stop = {
  activityId?: string;
  purpose?: "visit" | "breakfast" | "lunch" | "dinner";
  venueRules?: VenueRules | null;
  place: Place;
  startMinute: number | null;
  endMinute: number | null;
  stayMinutes: number;
};
export type Day = { date: string; items: Stop[]; legs: Leg[]; issues: string[] };
export type Draft = {
  input: TripInput;
  days: Day[];
  status: "unverified" | "infeasible";
  notices: string[];
};

export interface PlaceProvider {
  search(city: string, keyword: string): Promise<Place[]>;
}
export interface RouteProvider {
  route(origin: Coordinate, destination: Coordinate, mode: RouteMode): Promise<Route>;
}

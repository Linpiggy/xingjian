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
export type WalkingRoute = {
  mode: "walking";
  meters: number | null;
  seconds: number | null;
  segments: Coordinate[][];
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
  route: WalkingRoute | null;
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
  walking(origin: Coordinate, destination: Coordinate): Promise<WalkingRoute>;
}

import type { TripBrief } from "./trip-brief";
import type { Place } from "./models";
import type { MealDayPlan } from "./meal-planning";

export type ItineraryCandidate = {
  place: Place;
  kind: "visit" | "restaurant";
  query: string;
};
export type ItineraryChoice = { placeId: string; reason: string; stayMinutes: number };
export type ItineraryOutline = {
  title: string;
  summary: string;
  days: {
    theme: string;
    visits: ItineraryChoice[];
    breakfast: ItineraryChoice & { dish: string };
    lunch: ItineraryChoice & { dish: string };
    dinner: ItineraryChoice & { dish: string };
  }[];
};
export type ItineraryDay = {
  date: string;
  theme: string;
  schedule: MealDayPlan | null;
  recommendations: { activityId: string; reason: string; dish: string | null }[];
  notices: string[];
};
export type Itinerary = {
  brief: TripBrief;
  title: string;
  summary: string;
  days: ItineraryDay[];
  constraints: {
    label: string;
    status: "scheduled" | "unverified" | "conflict";
    message: string;
  }[];
  allocation: {
    category: "intercity" | "local" | "lodging" | "meals" | "tickets";
    targetFen: number;
  }[];
  model: string;
  generatedAt: string;
  fixture: boolean;
  status: "unverified" | "infeasible";
  notices: string[];
};

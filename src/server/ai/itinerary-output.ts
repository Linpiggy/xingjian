import { z } from "zod";
import type { ItineraryCandidate, ItineraryOutline } from "@/domain/itinerary";
import {
  itineraryGuideSchema,
  itineraryOutlineDaySchema,
  itineraryOutlineSchema,
} from "@/lib/itinerary-contracts";

// Models routinely add harmless keys (`name`, `id`, `tips`) and copy the long supplier
// ID next to the short key. Unknown keys are dropped instead of discarding the whole
// plan; every field the planner depends on stays required and validated.
const choice = z.object({
  key: z.string().regex(/^P\d{3,5}$/),
  reason: z.string().trim().min(1).max(160),
  stayMinutes: z.number().int().min(15).max(180),
});
const meal = choice.extend({ dish: z.string().trim().min(1).max(80) });
const compactDay = z.object({
  theme: z.string().trim().min(1).max(80),
  visits: z.array(choice).min(1).max(3),
  breakfast: meal,
  lunch: meal,
  dinner: meal,
});
const core = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(400),
  days: z.array(z.unknown()).min(1).max(14),
  guides: z.unknown().optional(),
});
export type ItineraryOutlineDraft = {
  title: string;
  summary: string;
  days: (ItineraryOutline["days"][number] | null)[];
  failedDays: number[];
  guides?: ItineraryOutline["guides"];
};

export const itineraryCandidateKey = (index: number) =>
  `P${String(index + 1).padStart(3, "0")}`;

function envelope(text: string): unknown {
  const raw = text.replace(/^\uFEFF/u, "").trim();
  // Exactly one complete envelope is allowed. No fragments, trailing-comma repair
  // or truncated JSON recovery; every day must still pass its own schema.
  const fence = /^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(raw);
  return JSON.parse(fence?.[1] ?? raw);
}

function resolveKey(
  key: string,
  candidates: ItineraryCandidate[],
  kind: ItineraryCandidate["kind"],
): string {
  const index = Number(key.slice(1)) - 1;
  const candidate = candidates[index];
  if (!candidate || itineraryCandidateKey(index) !== key || candidate.kind !== kind) {
    throw new Error("Unknown model candidate key");
  }
  return candidate.place.id;
}

function convert(
  item: z.infer<typeof choice>,
  candidates: ItineraryCandidate[],
  kind: ItineraryCandidate["kind"],
) {
  const { key, ...rest } = item;
  return { ...rest, placeId: resolveKey(key, candidates, kind) };
}

function readDay(
  value: unknown,
  candidates: ItineraryCandidate[],
): ItineraryOutline["days"][number] | null {
  const legacy = itineraryOutlineDaySchema.safeParse(value);
  if (legacy.success) {
    return legacy.data;
  }
  const wire = compactDay.safeParse(value);
  if (!wire.success) {
    return null;
  }
  const day = wire.data;
  try {
    return convertDay(day, candidates);
  } catch {
    return null;
  }
}

function convertDay(
  day: z.infer<typeof compactDay>,
  candidates: ItineraryCandidate[],
): ItineraryOutline["days"][number] | null {
  const resolved = itineraryOutlineDaySchema.safeParse({
    theme: day.theme,
    visits: day.visits.map((item) => convert(item, candidates, "visit")),
    breakfast: {
      ...convert(day.breakfast, candidates, "restaurant"),
      dish: day.breakfast.dish,
    },
    lunch: {
      ...convert(day.lunch, candidates, "restaurant"),
      dish: day.lunch.dish,
    },
    dinner: {
      ...convert(day.dinner, candidates, "restaurant"),
      dish: day.dinner.dish,
    },
  });
  return resolved.success ? resolved.data : null;
}

const legacyGuide = itineraryGuideSchema.extend({
  placeId: z.string().min(1).max(100),
});
const compactGuide = itineraryGuideSchema.extend({
  key: z.string().regex(/^P\d{3,5}$/),
});

function readGuide(
  entry: unknown,
  candidates: ItineraryCandidate[],
): NonNullable<ItineraryOutline["guides"]>[number] | null {
  const direct = legacyGuide.safeParse(entry);
  if (direct.success) {
    return direct.data;
  }
  const keyed = compactGuide.safeParse(entry);
  if (!keyed.success) {
    return null;
  }
  const { key, ...rest } = keyed.data;
  const index = Number(key.slice(1)) - 1;
  const candidate = candidates[index];
  return candidate && itineraryCandidateKey(index) === key
    ? { ...rest, placeId: candidate.place.id }
    : null;
}

function readGuides(
  value: unknown,
  candidates: ItineraryCandidate[],
  selected: Set<string>,
): ItineraryOutline["guides"] {
  if (!Array.isArray(value) || value.length > 84) {
    return undefined;
  }
  const guides: NonNullable<ItineraryOutline["guides"]> = [];
  for (const entry of value) {
    const guide = readGuide(entry, candidates);
    if (
      guide &&
      selected.has(guide.placeId) &&
      !guides.some((item) => item.placeId === guide.placeId)
    ) {
      guides.push(guide);
    }
  }
  return guides.length ? guides : undefined;
}

// Recovers the days that are individually valid so a single bad day no longer discards
// a whole multi-day plan. The caller may ask the model only for the missing days.
export function parseItineraryDraft(
  text: string,
  candidates: ItineraryCandidate[],
): ItineraryOutlineDraft {
  const value: unknown = envelope(text);
  const parsed = core.parse(value);
  const days = parsed.days.map((day) => readDay(day, candidates));
  const failedDays = days.flatMap((day, index) => (day === null ? [index] : []));
  const selected = new Set(
    days.flatMap((day) =>
      day
        ? [...day.visits, day.breakfast, day.lunch, day.dinner].map(
            (item) => item.placeId,
          )
        : [],
    ),
  );
  return {
    title: parsed.title,
    summary: parsed.summary,
    days,
    failedDays,
    ...(parsed.guides === undefined
      ? {}
      : { guides: readGuides(parsed.guides, candidates, selected) }),
  };
}

export function parseItineraryOutput(
  text: string,
  candidates: ItineraryCandidate[],
): ItineraryOutline {
  const draft = parseItineraryDraft(text, candidates);
  if (draft.failedDays.length) {
    throw new Error("Invalid model day");
  }
  return itineraryOutlineSchema.parse({
    title: draft.title,
    summary: draft.summary,
    days: draft.days,
    ...(draft.guides ? { guides: draft.guides } : {}),
  });
}

// The model may be asked only for the days that failed their own schema. Entries are
// matched by `dayIndex` when present, otherwise by request order.
export function parseDayCompletion(
  text: string,
  candidates: ItineraryCandidate[],
  requested: readonly number[],
): (ItineraryOutline["days"][number] | null)[] {
  const value: unknown = envelope(text);
  const entries = Array.isArray(value)
    ? value
    : z.object({ days: z.array(z.unknown()).min(1).max(14) }).parse(value).days;
  const result = requested.map(() => null) as (ItineraryOutline["days"][number] | null)[];
  entries.forEach((entry, position) => {
    const claimed =
      typeof entry === "object" && entry !== null && "dayIndex" in entry
        ? Number((entry as { dayIndex: unknown }).dayIndex)
        : (requested[position] ?? -1);
    const slot = requested.indexOf(claimed);
    if (slot >= 0) {
      result[slot] = readDay(entry, candidates);
    }
  });
  return result;
}

export function applyDayCompletion(
  draft: ItineraryOutlineDraft,
  completion: readonly (ItineraryOutline["days"][number] | null)[],
  requested: readonly number[],
): ItineraryOutlineDraft {
  const days = [...draft.days];
  requested.forEach((dayIndex, slot) => {
    const day = completion[slot];
    if (day) {
      days[dayIndex] = day;
    }
  });
  const selected = new Set(
    days.flatMap((day) =>
      day
        ? [...day.visits, day.breakfast, day.lunch, day.dinner].map(
            (item) => item.placeId,
          )
        : [],
    ),
  );
  const guides = (draft.guides ?? []).filter((guide) => selected.has(guide.placeId));
  return {
    title: draft.title,
    summary: draft.summary,
    days,
    failedDays: days.flatMap((day, index) => (day === null ? [index] : [])),
    ...(guides.length ? { guides } : {}),
  };
}

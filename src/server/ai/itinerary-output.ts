import { z } from "zod";
import type { ItineraryCandidate, ItineraryOutline } from "@/domain/itinerary";
import { itineraryGuideSchema, itineraryOutlineSchema } from "@/lib/itinerary-contracts";

const choice = z.strictObject({
  key: z.string().regex(/^P\d{3,5}$/),
  reason: z.string().trim().min(1).max(160),
  stayMinutes: z.number().int().min(15).max(180),
});
const meal = choice.extend({ dish: z.string().trim().min(1).max(80) });
const compact = z.strictObject({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(400),
  days: z
    .array(
      z.strictObject({
        theme: z.string().trim().min(1).max(80),
        visits: z.array(choice).min(1).max(3),
        breakfast: meal,
        lunch: meal,
        dinner: meal,
      }),
    )
    .min(1)
    .max(14),
  guides: z.unknown().optional(),
});
export const itineraryCandidateKey = (index: number) =>
  `P${String(index + 1).padStart(3, "0")}`;

export function parseItineraryOutput(
  text: string,
  candidates: ItineraryCandidate[],
): ItineraryOutline {
  const raw = text.replace(/^\uFEFF/u, "").trim();
  // Exactly one complete envelope is allowed. No fragments, trailing-comma repair
  // or truncated JSON recovery; the full core must pass the schema.
  const fence = /^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(raw);
  const value: unknown = JSON.parse(fence?.[1] ?? raw);
  const legacy = itineraryOutlineSchema.safeParse(value);
  if (legacy.success) {
    return legacy.data;
  }
  const wire = compact.parse(value);
  const resolve = (key: string, kind?: ItineraryCandidate["kind"]) => {
    const index = Number(key.slice(1)) - 1;
    const candidate = candidates[index];
    if (
      !candidate ||
      itineraryCandidateKey(index) !== key ||
      (kind && candidate.kind !== kind)
    ) {
      throw new Error("Unknown model candidate key");
    }
    return candidate.place.id;
  };
  const convert = (item: z.infer<typeof choice>, kind: ItineraryCandidate["kind"]) => {
    const { key, ...rest } = item;
    return { ...rest, placeId: resolve(key, kind) };
  };
  const days = wire.days.map((day) => ({
    theme: day.theme,
    visits: day.visits.map((item) => convert(item, "visit")),
    breakfast: { ...convert(day.breakfast, "restaurant"), dish: day.breakfast.dish },
    lunch: { ...convert(day.lunch, "restaurant"), dish: day.lunch.dish },
    dinner: { ...convert(day.dinner, "restaurant"), dish: day.dinner.dish },
  }));
  const selected = new Set(
    days.flatMap((day) =>
      [...day.visits, day.breakfast, day.lunch, day.dinner].map((item) => item.placeId),
    ),
  );
  const guides: NonNullable<ItineraryOutline["guides"]> = [];
  const guideWire = itineraryGuideSchema.extend({ key: z.string().regex(/^P\d{3,5}$/) });
  if (Array.isArray(wire.guides) && wire.guides.length <= 84) {
    for (const entry of wire.guides) {
      const parsed = guideWire.safeParse(entry);
      if (!parsed.success) {
        continue;
      }
      const { key, ...guide } = parsed.data;
      const candidate = candidates[Number(key.slice(1)) - 1];
      if (
        candidate &&
        itineraryCandidateKey(Number(key.slice(1)) - 1) === key &&
        selected.has(candidate.place.id) &&
        !guides.some((item) => item.placeId === candidate.place.id)
      ) {
        guides.push({ ...guide, placeId: candidate.place.id });
      }
    }
  }
  return itineraryOutlineSchema.parse({
    title: wire.title,
    summary: wire.summary,
    days,
    ...(guides.length ? { guides } : {}),
  });
}

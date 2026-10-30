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

const MEAL_KEYS = new Set(["breakfast", "lunch", "dinner"]);

const previousSignificant = (text: string, index: number) => {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!/\s/u.test(text[i] ?? "")) {
      return text[i];
    }
  }
  return "";
};

/**
 * 模型偶发把三餐写成多包一层花括号的对象：`"breakfast":{...},{"lunch":{...}}`。
 * 这里只收集「紧跟逗号、且首键是 breakfast/lunch/dinner」的多余花括号，并给出两种确定性候选：
 * A. 只删多余的开括号（模型只在末尾补了收括号时适用）；
 * B. 连同其配对的收括号一起删（模型写成了成对包裹时适用）。
 * 两种候选都要再通过 JSON.parse 与 Zod，错的一律拒绝。
 */
function mealRepairCandidates(body: string): string[] {
  const strays: number[] = [];
  const stack: number[] = [];
  const closeOf = new Map<number, number>();
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"') {
      i += 1;
      while (i < body.length && body[i] !== '"') {
        if (body[i] === "\\") {
          i += 1;
        }
        i += 1;
      }
      continue;
    }
    if (char === "{") {
      const match = /^\{\s*"([A-Za-z]+)"\s*:/u.exec(body.slice(i, i + 40));
      if (
        match &&
        MEAL_KEYS.has(match[1] ?? "") &&
        previousSignificant(body, i) === ","
      ) {
        strays.push(i);
      }
      stack.push(i);
      continue;
    }
    if (char === "}") {
      const opened = stack.pop();
      if (opened !== undefined) {
        closeOf.set(opened, i);
      }
    }
  }
  if (!strays.length) {
    return [];
  }
  const opensOnly = [...body];
  for (const index of strays) {
    opensOnly[index] = "";
  }
  const candidates = [opensOnly.join("")];
  const opensAndCloses = [...body];
  for (const index of strays) {
    opensAndCloses[index] = "";
    const close = closeOf.get(index);
    if (close !== undefined) {
      opensAndCloses[close] = "";
    }
  }
  const paired = opensAndCloses.join("");
  if (paired !== candidates[0]) {
    candidates.push(paired);
  }
  return candidates;
}

function envelope(text: string): unknown {
  const raw = text.replace(/^\uFEFF/u, "").trim();
  // 只接受一个完整信封；不做片段抽取，也不补全被截断的内容。
  const fence = /^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(raw);
  const body = fence?.[1] ?? raw;
  const parse = () => JSON.parse(body);
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    // ① 末尾多一个逗号（category=property_name 且确实是 ,} 或 ,]）
    if (/property name/i.test(error.message) && /,\s*[}\]]/.test(body)) {
      try {
        const repaired = JSON.parse(body.replace(/,(\s*[}\]])/g, "$1"));
        console.warn(
          `[itinerary-json-repaired] ${JSON.stringify({ kind: "trailing_comma" })}`,
        );
        return repaired;
      } catch {
        /* 继续尝试下一种确定性修复 */
      }
    }
    // ② 三餐被多包一层对象（property_name 指向 {"lunch": 之类的位置）
    if (/property name/i.test(error.message)) {
      for (const candidate of mealRepairCandidates(body)) {
        try {
          const repaired = JSON.parse(candidate);
          console.warn(
            `[itinerary-json-repaired] ${JSON.stringify({ kind: "meal_wrapper" })}`,
          );
          return repaired;
        } catch {
          /* 试下一种候选 */
        }
      }
    }
    throw error;
  }
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

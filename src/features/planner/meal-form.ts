import type { EditState } from "@/domain/editing";
import type { Place } from "@/domain/models";
import type { MealEntry, MealSetup } from "@/domain/meals";
import {
  atShanghaiMinute,
  parseShanghaiLocalDateTime,
  toShanghaiLocalDateTime,
} from "@/domain/intercity";
import { mealSetupSchema } from "@/lib/meal-setup-contracts";
import { parseYuanFen } from "@/lib/money";
import { buildVenueRules, initialVenueFields, type VenueFields } from "./venue-form";

export const mealLabels = { lunch: "午餐", dinner: "晚餐" } as const;
export type MealFields = {
  id: string;
  place: Place | null;
  afterPlaceId: string;
  stay: string;
  start: string;
  end: string;
  price: string;
  dietary: MealEntry["meal"]["dietaryCheck"];
  venue: VenueFields;
};
export type MealForm = { end: string; slots: Record<"lunch" | "dinner", MealFields> };
function local(date: string, minute: number): string {
  const instant = atShanghaiMinute(date, minute);
  if (instant === null) {
    throw new Error("用餐时间未知，请明确填写完整日期时间。");
  }
  return toShanghaiLocalDateTime(instant);
}
export function initialMealForm(state: EditState, dayIndex: number): MealForm {
  const day = state.draft.days[dayIndex];
  const previous = state.meals.days.find((item) => item.date === day.date);
  const fields = (kind: "lunch" | "dinner"): MealFields => {
    const entry = previous?.entries.find((item) => item.kind === kind);
    return {
      id: entry?.id ?? `activity:${crypto.randomUUID()}`,
      place: entry ? structuredClone(entry.place) : null,
      afterPlaceId: entry
        ? (entry.afterPlaceId ?? "")
        : kind === "lunch"
          ? day.items[0].place.id
          : day.items.at(-1)!.place.id,
      stay: String(entry?.stayMinutes ?? 60),
      start: local(
        day.date,
        entry?.window.startMinute ?? (kind === "lunch" ? 690 : 1050),
      ),
      end: local(day.date, entry?.window.endMinute ?? (kind === "lunch" ? 840 : 1200)),
      price:
        entry?.meal.perPersonFen == null
          ? ""
          : (entry.meal.perPersonFen / 100).toFixed(2),
      dietary: entry?.meal.dietaryCheck ?? "unknown",
      venue: initialVenueFields(entry?.rules ?? null, day.date, entry?.place ?? null),
    };
  };
  return {
    end: local(day.date, previous?.endMinute ?? 1260),
    slots: { lunch: fields("lunch"), dinner: fields("dinner") },
  };
}
function minute(date: string, value: string): number {
  return (
    (Date.parse(parseShanghaiLocalDateTime(value)) -
      Date.parse(parseShanghaiLocalDateTime(`${date}T00:00`))) /
    60_000
  );
}
export function buildMealForm(
  state: EditState,
  dayIndex: number,
  form: MealForm,
  recordedAt: string,
): MealSetup {
  const date = state.draft.days[dayIndex].date;
  const previous = state.meals.days.find((day) => day.date === date);
  const entries = (["lunch", "dinner"] as const).map((kind): MealEntry => {
    const fields = form.slots[kind];
    if (!fields.place) {
      throw new Error(`请搜索并明确选择${mealLabels[kind]}餐厅，不会按名称自动替换。`);
    }
    if (
      fields.afterPlaceId &&
      !state.draft.days[dayIndex].items.some(
        (item) => item.place.id === fields.afterPlaceId,
      )
    ) {
      throw new Error("用餐插入位置已变化，请重新选择。");
    }
    if (
      !/^\d+$/.test(fields.stay) ||
      Number(fields.stay) < 15 ||
      Number(fields.stay) > 240
    ) {
      throw new Error("用餐停留须为 15—240 的整数分钟。");
    }
    const price = fields.price.trim() ? parseYuanFen(fields.price.trim()) : null;
    if (fields.price.trim() && (price === null || price > 10_000_000)) {
      throw new Error("餐费须为非负金额，最多两位小数且不超过十万元；留空表示未知。");
    }
    const old = previous?.entries.find(
      (item) => item.id === fields.id && item.kind === kind,
    );
    const sameVenue =
      old?.place.id === fields.place.id &&
      old.place.location.every((value, index) => value === fields.place!.location[index]);
    const rules = buildVenueRules(
      fields.venue,
      fields.place,
      sameVenue ? (old?.rules ?? null) : null,
      recordedAt,
    );
    if (old?.rules?.reservation.state === "confirmed" && !fields.venue.releaseConfirmed) {
      if (!sameVenue) {
        throw new Error("原餐厅有已记录预约，不能随替换静默移除；请先核对原预约安排。");
      }
      if (
        rules?.date !== old.rules.date ||
        JSON.stringify(rules.reservation) !== JSON.stringify(old.rules.reservation)
      ) {
        throw new Error("原预约为强约束，变更或移除须先明确核对，不会代为取消商家预约。");
      }
    }
    return {
      id: fields.id,
      kind,
      place: structuredClone(fields.place),
      afterPlaceId: fields.afterPlaceId || null,
      stayMinutes: Number(fields.stay),
      window: {
        startMinute: minute(date, fields.start),
        endMinute: minute(date, fields.end),
      },
      fixedStartMinute: old?.fixedStartMinute ?? null,
      rules,
      meal: {
        perPersonFen: price,
        dietaryCheck: fields.dietary,
        source:
          sameVenue &&
          old &&
          old.meal.perPersonFen === price &&
          old.meal.dietaryCheck === fields.dietary
            ? structuredClone(old.meal.source)
            : { kind: "user", recordedAt },
      },
    };
  });
  return mealSetupSchema.parse({
    days: [
      ...state.meals.days.filter((day) => day.date !== date),
      { date, endMinute: minute(date, form.end), entries },
    ],
    connections: state.meals.connections,
  });
}
export function withoutMealDay(
  state: EditState,
  dayIndex: number,
  releaseConfirmed = false,
): MealSetup {
  if (
    !releaseConfirmed &&
    state.meals.days
      .find((day) => day.date === state.draft.days[dayIndex].date)
      ?.entries.some((entry) => entry.rules?.reservation.state === "confirmed")
  ) {
    throw new Error(
      "移除含已记录预约的餐次前，请先明确核对原预约变更／移除；不会代为取消商家预约。",
    );
  }
  const days = state.meals.days.filter(
    (day) => day.date !== state.draft.days[dayIndex].date,
  );
  return mealSetupSchema.parse({
    days,
    connections: days.length ? state.meals.connections : [],
  });
}
export function mealCostText(setup: MealSetup, dayCount: number): string {
  const entries = setup.days.flatMap((day) => day.entries);
  const known = entries.filter((entry) => entry.meal.perPersonFen !== null);
  const sum = known.reduce((total, entry) => total + entry.meal.perPersonFen!, 0);
  return `餐次人均已知估算 ¥${(sum / 100).toFixed(2)}；${dayCount * 2 - known.length} 餐费用未知／未安排。`;
}

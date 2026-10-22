import { z } from "zod";
import { tripPurposes, type TripBrief } from "@/domain/trip-brief";

const name = z.string().trim().min(1).max(60);
const minute = z.number().int().min(0).max(1439);
const endMinute = z.number().int().min(1).max(1440);
const key = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-CN");
export const tripBriefSchema: z.ZodType<TripBrief> = z
  .strictObject({
    destinationCity: z.string().trim().min(1, "请输入目的地城市。").max(40),
    originCity: z.string().trim().min(1).max(40).nullable(),
    startDate: z.iso.date(),
    dayCount: z.number().int().min(1, "至少安排一天。").max(14, "本版最多安排十四天。"),
    travelers: z
      .number()
      .int()
      .min(1, "至少一位旅客。")
      .max(20, "本版最多二十位同行者。"),
    budget: z
      .strictObject({
        amountFen: z.number().int().min(0).max(200_000_000),
        basis: z.enum(["per_person", "total"]),
        includeIntercity: z.boolean(),
        includeLodging: z.boolean(),
      })
      .refine(
        (budget) => budget.basis !== "per_person" || budget.amountFen <= 10_000_000,
        "每人预算目标最多十万元。",
      ),
    availability: z
      .strictObject({
        firstDayStartMinute: minute,
        lastDayEndMinute: endMinute,
        dailyStartMinute: minute,
        dailyEndMinute: endMinute,
      })
      .refine(
        (availability) => availability.dailyEndMinute > availability.dailyStartMinute,
        "每天可游玩结束时间须晚于开始时间。",
      ),
    mainPurpose: z.enum(tripPurposes),
    secondaryPurposes: z.array(z.enum(tripPurposes)).max(5),
    pace: z.enum(["relaxed", "balanced", "packed"]),
    mustVisit: z.array(name).max(30),
    mustEat: z
      .array(z.strictObject({ kind: z.enum(["dish", "restaurant"]), name }))
      .max(20),
    dietary: z.strictObject({
      avoid: z.array(name).max(10),
      allergies: z.array(name).max(10),
    }),
  })
  .superRefine((brief, context) => {
    if (
      brief.budget.basis === "total" &&
      brief.budget.amountFen > brief.travelers * 10_000_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["budget", "amountFen"],
        message: "总预算目标不能超过同行人数乘以每人十万元。",
      });
    }
    if (
      brief.dayCount === 1 &&
      brief.availability.firstDayStartMinute >= brief.availability.lastDayEndMinute
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability", "lastDayEndMinute"],
        message: "一日游的离开时间须晚于可用开始时间。",
      });
    }
    if (
      new Set(brief.secondaryPurposes).size !== brief.secondaryPurposes.length ||
      brief.secondaryPurposes.includes(brief.mainPurpose)
    ) {
      context.addIssue({
        code: "custom",
        path: ["secondaryPurposes"],
        message: "旅行目的不能重复；主要目的单独保留。",
      });
    }
    const unique = (values: string[], path: string[]) => {
      if (new Set(values.map(key)).size !== values.length) {
        context.addIssue({ code: "custom", path, message: "同一项需求不必重复填写。" });
      }
    };
    unique(brief.mustVisit, ["mustVisit"]);
    unique(
      brief.mustEat.map((item) => `${item.kind}:${item.name}`),
      ["mustEat"],
    );
    unique(brief.dietary.avoid, ["dietary", "avoid"]);
    unique(brief.dietary.allergies, ["dietary", "allergies"]);
  });

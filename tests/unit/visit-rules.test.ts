import { describe, expect, it } from "vitest";
import {
  commitVisitRules,
  previewVisitRules,
  createEditState,
  commitEdit,
  previewEdit,
  resolveEdit,
  undoEdit,
  toggleStopLock,
  commitMeals,
  previewMeals,
  resolveMeals,
} from "@/domain/editing";
import { deriveMealTrip, emptyMeals, type MealSetup } from "@/domain/meals";
import {
  scheduleMealDay,
  scheduleVisitDay,
  type VenueRules,
} from "@/domain/meal-planning";
import { draftSchema } from "@/lib/contracts";
import { useDraftEditor } from "@/features/itinerary/legacy/editor-store";
import { fixtureDraft, places, route } from "../fixtures/draft";

const fresh = () => createEditState(fixtureDraft(), "visit-rules-fixture");
function rules(): VenueRules {
  return {
    date: "2026-10-17",
    openingWindows: [{ startMinute: 600, endMinute: 1020 }],
    lastEntryMinute: 960,
    reservation: { state: "not_required", entryWindow: null },
    source: { kind: "user", recordedAt: "2026-10-15T01:00:00Z" },
  };
}
function booked() {
  const current = fresh();
  const facts = rules();
  facts.reservation = {
    state: "confirmed",
    entryWindow: { startMinute: 600, endMinute: 620 },
  };
  return commitVisitRules(current, previewVisitRules(current, places[0].id, facts));
}
describe("dated visit rules in the same derived activity timeline", () => {
  it("waits for known opening without inventing meals or routes and preserves a single immutable input snapshot", () => {
    const current = fresh();
    const original = structuredClone(current);
    const proposal = previewVisitRules(current, places[0].id, rules());
    expect(proposal.view.draft.days[0].items.map((item) => item.startMinute)).toEqual([
      600, 725,
    ]);
    expect(
      proposal.view.plans[0].issues.some((issue) => issue.code === "meal_count"),
    ).toBe(false);
    expect(proposal.view.gaps).toEqual([]);
    const next = commitVisitRules(current, proposal);
    expect(next.draft.days[0].items[0].startMinute).toBe(540);
    expect(
      deriveMealTrip(next.draft, next.locks, next.meals).draft.days[0].items[0]
        .startMinute,
    ).toBe(600);
    expect(next.meals).toEqual(emptyMeals());
    expect(next.budget).toEqual(current.budget);
    expect(next.draft.days[0].items[0].venueRules?.source).toEqual(rules().source);
    expect(undoEdit(next).draft).toEqual(current.draft);
    expect(current).toEqual(original);
  });
  it("retains facts and their original clock through reordering and actual neighbour route resolution", () => {
    const current = commitVisitRules(
      fresh(),
      previewVisitRules(fresh(), places[0].id, rules()),
    );
    const proposal = previewEdit(current, {
      placeId: places[0].id,
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    const resolved = resolveEdit(
      current,
      proposal,
      proposal.gaps.map(() => structuredClone(route)),
    );
    const next = commitEdit(current, resolved);
    expect(next.draft.days[0].items[1].venueRules).toEqual(rules());
    expect(next.draft.days[0].items[1].venueRules?.source.recordedAt).toBe(
      rules().source.recordedAt,
    );
  });
  it("blocks closed days, insufficient continuous opening and the exclusive appointment end, and does not trust a tampered preview", () => {
    const current = fresh();
    const closed = rules();
    closed.openingWindows = [];
    const proposal = previewVisitRules(current, places[0].id, closed);
    proposal.view.conflicts = [];
    proposal.view.draft.status = "unverified";
    expect(() => commitVisitRules(current, proposal)).toThrow("景点规则存在");
    const short = rules();
    short.openingWindows = [{ startMinute: 600, endMinute: 660 }];
    expect(
      previewVisitRules(current, places[0].id, short).view.conflicts.length,
    ).toBeGreaterThan(0);
    const late = rules();
    late.reservation = {
      state: "confirmed",
      entryWindow: { startMinute: 590, endMinute: 600 },
    };
    expect(
      previewVisitRules(current, places[0].id, late).view.conflicts.length,
    ).toBeGreaterThan(0);
    expect(current.draft.days[0].items[0].venueRules).toBeUndefined();
  });
  it("keeps unknown transport unknown even after a known opening window, without creating new route queries", () => {
    const current = fresh();
    current.draft.days[0].legs[0] = {
      ...current.draft.days[0].legs[0],
      route: null,
      error: "fixture unavailable",
    };
    const proposal = previewVisitRules(current, places[0].id, rules());
    expect(proposal.view.draft.days[0].items[1].startMinute).toBeNull();
    expect(proposal.view.gaps).toEqual([]);
    expect(commitVisitRules(current, proposal).version).toBe(1);
  });
  it("does not turn an old rule date into today's facts and refuses a confirmed appointment on the wrong activity date", () => {
    const current = fresh();
    const facts = rules();
    facts.date = "2026-10-18";
    const unknown = previewVisitRules(current, places[0].id, facts);
    expect(
      unknown.view.plans[0].issues.some((issue) => issue.code === "rules_date_mismatch"),
    ).toBe(true);
    expect(unknown.view.draft.days[0].items[0].startMinute).toBe(540);
    facts.reservation = { state: "confirmed", entryWindow: null };
    const conflict = previewVisitRules(current, places[0].id, facts);
    expect(conflict.view.conflicts.join(" ")).toContain("预约的适用日期");
    expect(() => commitVisitRules(current, conflict)).toThrow("预约");
  });
  it("cannot silently invalidate a confirmed visit appointment through cross-day movement", () => {
    const current = booked();
    const proposal = previewEdit(current, {
      placeId: places[0].id,
      toDay: 1,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(proposal.conflicts.join(" ")).toContain("预约");
    const resolved = resolveEdit(
      current,
      proposal,
      proposal.gaps.map(() => structuredClone(route)),
    );
    expect(() => commitEdit(current, resolved)).toThrow("时间或锁定冲突");
    expect(current.draft.days[0].items[0].venueRules?.date).toBe("2026-10-17");
  });
  it("requires bound release when clearing a confirmed visit appointment and rejects changed targets or versions", () => {
    const current = booked();
    const proposal = previewVisitRules(current, places[0].id, null);
    proposal.view.conflicts = [];
    expect(() => commitVisitRules(current, proposal)).toThrow("预约变更须明确核对");
    const accepted = previewVisitRules(
      current,
      places[0].id,
      null,
      proposal.requiredRelease,
    );
    expect(
      commitVisitRules(current, accepted).draft.days[0].items[0].venueRules,
    ).toBeNull();
    accepted.rules = { ...rules(), reservation: { state: "unknown", entryWindow: null } };
    expect(() => commitVisitRules(current, accepted)).toThrow("核对与当前修改不一致");
    expect(() => commitVisitRules(undoEdit(current), proposal)).toThrow("行程已变化");
    expect(() => commitVisitRules({ ...current, sessionId: "other" }, proposal)).toThrow(
      "行程已变化",
    );
  });
  it("retains downstream time locks when a changed opening pushes later activities back", () => {
    const base = commitVisitRules(
      fresh(),
      previewVisitRules(fresh(), places[0].id, rules()),
    );
    const current = toggleStopLock(base, places[1].id, "time");
    expect(current.locks[places[1].id].time?.minute).toBe(725);
    const facts = rules();
    facts.openingWindows![0].startMinute = 660;
    expect(() =>
      commitVisitRules(current, previewVisitRules(current, places[0].id, facts)),
    ).toThrow("锁定");
    expect(current.locks[places[1].id].time?.minute).toBe(725);
  });
  it("merges visit constraints into days that already include formal meals and preserves them after meal removal", () => {
    const current = booked();
    const setup: MealSetup = {
      days: [
        {
          date: "2026-10-17",
          endMinute: 1260,
          entries: (["lunch", "dinner"] as const).map((kind, index) => ({
            id: `activity:visit-rules-${kind}`,
            kind,
            afterPlaceId: places[index].id,
            place: structuredClone(places[index]),
            stayMinutes: 60,
            window: { startMinute: index ? 1050 : 690, endMinute: index ? 1200 : 840 },
            fixedStartMinute: null,
            rules: null,
            meal: { perPersonFen: null, dietaryCheck: "unknown", source: rules().source },
          })),
        },
      ],
      connections: [],
    };
    const pending = previewMeals(current, setup);
    const mealProposal = resolveMeals(
      current,
      pending,
      pending.view.gaps.map(() => structuredClone(route)),
    );
    expect(mealProposal.view.draft.days[0].items.map((item) => item.startMinute)).toEqual(
      [600, 725, 820, 1050],
    );
    const withMeals = commitMeals(current, mealProposal);
    const removed = commitMeals(withMeals, previewMeals(withMeals, emptyMeals()));
    expect(removed.draft.days[0].items[0].venueRules?.reservation.state).toBe(
      "confirmed",
    );
    expect(
      deriveMealTrip(removed.draft, removed.locks, removed.meals).draft.days[0].items[0]
        .startMinute,
    ).toBe(600);
  });
  it("does not expose a bypass for the formal meal count via the visit-only scheduler", () => {
    const projection = previewVisitRules(fresh(), places[0].id, rules()).view.plans[0];
    const input = {
      date: projection.date,
      timeZone: "Asia/Shanghai" as const,
      startMinute: 540,
      endMinute: 1080,
      bufferMinutes: 15,
      activities: projection.items.map((item) => item.activity),
      legs: projection.legs,
    };
    expect(
      scheduleVisitDay(input).issues.some((issue) => issue.code === "meal_count"),
    ).toBe(false);
    expect(
      scheduleMealDay(input).issues.some((issue) => issue.code === "meal_count"),
    ).toBe(true);
    input.activities[0].kind = "lunch";
    expect(() => scheduleVisitDay(input)).toThrow("不能绕过");
  });
  it("validates optional draft facts and the store boundary without accepting fake provenance or private extra fields", () => {
    const current = fresh();
    const proposal = previewVisitRules(current, places[0].id, rules());
    expect(draftSchema.parse(proposal.draft).days[0].items[0].venueRules).toEqual(
      rules(),
    );
    useDraftEditor.setState({ current });
    try {
      const invalid = {
        ...rules(),
        source: { kind: "provider", recordedAt: rules().source.recordedAt },
      };
      const bad = { ...proposal, rules: { ...rules(), receipt: "forbidden" } };
      expect(
        draftSchema.safeParse({
          ...proposal.draft,
          days: [
            {
              ...proposal.draft.days[0],
              items: [{ ...proposal.draft.days[0].items[0], venueRules: invalid }],
            },
          ],
        }).success,
      ).toBe(false);
      expect(() => useDraftEditor.getState().confirmVisitRules(bad)).toThrow();
      expect(useDraftEditor.getState().current).toBe(current);
      useDraftEditor.getState().confirmVisitRules(proposal);
      expect(
        useDraftEditor.getState().current!.draft.days[0].items[0].venueRules,
      ).toEqual(rules());
    } finally {
      useDraftEditor.getState().reset();
    }
  });
});

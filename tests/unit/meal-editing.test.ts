import { describe, expect, it } from "vitest";
import {
  commitBudget,
  commitEdit,
  commitIntercity,
  commitMeals,
  createEditState,
  previewBudget,
  previewEdit,
  previewIntercity,
  previewMeals,
  resolveEdit,
  resolveMeals,
  toggleStopLock,
  undoEdit,
} from "@/domain/editing";
import {
  deriveMealTrip,
  emptyMeals,
  visitActivityId,
  type MealEntry,
  type MealSetup,
} from "@/domain/meals";
import {
  mealSetupSchema,
  mealReservationReleasesSchema,
} from "@/lib/meal-setup-contracts";
import { mealReservationReleases } from "@/domain/meal-reservations";
import { draftSchema } from "@/lib/contracts";
import { useDraftEditor } from "@/features/planner/editor-store";
import {
  initialIntercityForm,
  buildIntercityForm,
} from "@/features/planner/intercity-form";
import { buildShareSnapshot } from "@/server/security/share-snapshot";
import { storageExpiry } from "@/server/security/storage-policy";
import { fixtureDraft, places, route, source } from "../fixtures/draft";

const state = () => createEditState(structuredClone(fixtureDraft()), "meal-session");
function setup(dayIndex = 0): MealSetup {
  const date = dayIndex ? "2026-10-18" : "2026-10-17";
  const entries: MealEntry[] = (["lunch", "dinner"] as const).map((kind, index) => ({
    id: `activity:${kind}-one`,
    kind,
    afterPlaceId: places[dayIndex * 2 + index].id,
    place: {
      ...structuredClone(places[index]),
      id: `meal-${kind}`,
      name: `私密${kind}餐厅`,
      address: "private-food-address",
    },
    stayMinutes: 60,
    window: { startMinute: index ? 1050 : 690, endMinute: index ? 1200 : 840 },
    fixedStartMinute: null,
    rules: null,
    meal: {
      perPersonFen: index ? null : 110,
      dietaryCheck: "unknown",
      source: { kind: "user", recordedAt: "2026-10-14T01:00:00Z" },
    },
  }));
  return { days: [{ date, endMinute: 1260, entries }], connections: [] };
}
function completed(base = state(), input = setup()): MealSetup {
  const view = previewMeals(base, input).view;
  return mealSetupSchema.parse({
    ...input,
    connections: view.gaps.map((gap) => ({
      fromActivityId: gap.fromId,
      toActivityId: gap.toId,
      origin: gap.origin,
      destination: gap.destination,
      route: structuredClone(route),
    })),
  });
}
function saved() {
  const base = state();
  return commitMeals(base, previewMeals(base, completed(base)));
}
function afterSecondVisit(sameVenue = false) {
  const base = state();
  const input = setup();
  for (const entry of input.days[0].entries) {
    entry.afterPlaceId = "fixture-1";
    if (sameVenue) {
      entry.place = structuredClone(places[1]);
    }
  }
  input.days[0].entries[0].stayMinutes = 30;
  return commitMeals(base, previewMeals(base, completed(base, input)));
}
function reorderWithMeals() {
  const current = afterSecondVisit();
  const proposal = previewEdit(current, {
    placeId: "fixture-0",
    toDay: 0,
    toIndex: 1,
    stayMinutes: 90,
  });
  return commitEdit(current, resolveEdit(current, proposal, [structuredClone(route)]));
}

describe("local meal snapshot/projection bridge, no persistence or connected meal UI", () => {
  it("previews new directed meal edges without changing visits, input, budget or locks", () => {
    const base = state();
    const original = structuredClone(base);
    const proposal = previewMeals(base, setup());
    expect(proposal.view.gaps).toHaveLength(3);
    expect(proposal.view.gaps[0].fromId).toBe(visitActivityId("fixture-0"));
    expect(proposal.view.gaps[0].toId).toBe("activity:lunch-one");
    expect(proposal.view.draft.days[0].items.map((item) => item.purpose)).toEqual([
      "visit",
      "lunch",
      "visit",
      "dinner",
    ]);
    expect(proposal.view.draft.days[0].items[2].startMinute).toBeNull();
    proposal.view.gaps[0].origin[0] += 0.1;
    expect(base).toEqual(original);
    expect(() => commitMeals(base, proposal)).toThrow("先查询用餐影响");
  });
  it("commits only meal choices/connections and derives full times; undo restores content as a new version", () => {
    const base = toggleStopLock(state(), "fixture-0", "position");
    const data = completed(base);
    const proposal = previewMeals(base, data);
    const changed = commitMeals(base, proposal);
    expect(changed.draft).toEqual(base.draft);
    expect(changed.budget).toEqual(base.budget);
    expect(changed.locks).toEqual(base.locks);
    expect(changed.version).toBe(base.version + 1);
    const view = deriveMealTrip(changed.draft, changed.locks, changed.meals);
    expect(view.draft.days[0].items.map((item) => item.startMinute)).toEqual([
      540, 690, 785, 1050,
    ]);
    expect(view.draft.days[0].items[3].endMinute).toBe(1110);
    expect(view.draft.status).toBe("unverified");
    expect(draftSchema.parse(view.draft).days[0].items[1].purpose).toBe("lunch");
    proposal.setup.days[0].entries[0].place.name = "mutated proposal";
    expect(changed.meals.days[0].entries[0].place.name).not.toBe("mutated proposal");
    const undone = undoEdit(changed);
    expect(undone.meals).toEqual(emptyMeals());
    expect(undone.version).toBe(changed.version + 1);
    expect(undone.locks).toEqual(base.locks);
  });
  it("rejects stale or cross-session previews after budget/locks/meal confirmation/undo", () => {
    const base = state();
    const proposal = previewMeals(base, completed(base));
    const changed = commitMeals(base, proposal);
    for (const current of [
      changed,
      undoEdit(changed),
      toggleStopLock(base, "fixture-0", "position"),
      commitBudget(base, previewBudget(base, base.budget)),
      createEditState(base.draft, "other"),
    ]) {
      expect(() => commitMeals(current, proposal)).toThrow("行程已变化");
    }
  });
  it("recomputes rather than trusting tampered report/time projections", () => {
    const base = state();
    const proposal = previewMeals(base, completed(base));
    proposal.setup.days[0].entries[0].window.endMinute = 700;
    proposal.view.conflicts = [];
    proposal.view.draft.status = "unverified";
    expect(() => commitMeals(base, proposal)).toThrow("用餐安排存在");
    expect(base.meals).toEqual(emptyMeals());
  });
  it("retains positional/time locks, including indirect shifts by meal insertion", () => {
    for (const kind of ["position", "time"] as const) {
      const base = toggleStopLock(state(), "fixture-1", kind);
      const proposal = previewMeals(base, completed(base));
      expect(proposal.view.conflicts.length).toBeGreaterThan(0);
      expect(() => commitMeals(base, proposal)).toThrow("锁定冲突");
      expect(base.locks["fixture-1"][kind]).toBeDefined();
    }
    const current = saved();
    const locked = toggleStopLock(current, "fixture-1", "time");
    expect(locked.locks["fixture-1"].time?.minute).toBe(785);
    const proposal = previewEdit(locked, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 0,
      stayMinutes: 150,
    });
    expect(proposal.conflicts.length).toBeGreaterThan(0);
    expect(() => commitEdit(locked, proposal)).toThrow("时间或锁定冲突");
  });
  it("revalidates ordinary stay edits against complete meal times without overwriting meal input", () => {
    const current = saved();
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 0,
      stayMinutes: 100,
    });
    const changed = commitEdit(current, proposal);
    expect(changed.meals).toEqual(current.meals);
    expect(proposal.effectiveDraft.days[0].items[2].startMinute).toBe(785);
    expect(
      deriveMealTrip(changed.draft, changed.locks, changed.meals).draft.days[0].items[2]
        .startMinute,
    ).toBe(785);
  });
  it("does not silently delete or reanchor meals when the anchor visit moves across days", () => {
    const current = saved();
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 1,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(proposal.conflicts.join(" ")).toContain("插入位置");
    expect(
      proposal.effectiveDraft.days[0].items.some(
        (item) => item.activityId === "activity:lunch-one",
      ),
    ).toBe(true);
    expect(current.meals.days[0].entries[0].afterPlaceId).toBe("fixture-0");
    const resolved = resolveEdit(
      current,
      proposal,
      proposal.gaps.map(() => route),
    );
    expect(() => commitEdit(current, resolved)).toThrow("时间或锁定冲突");
  });
  it("invalidates same-instance routes when venue coordinates change and reuses unchanged directions", () => {
    const current = saved();
    expect(previewMeals(current, current.meals).view.gaps).toHaveLength(0);
    const data = structuredClone(current.meals);
    data.days[0].entries[0].place.location[0] += 0.01;
    const proposal = previewMeals(current, data);
    expect(proposal.view.gaps).toHaveLength(2);
    expect(proposal.view.gaps.map((gap) => gap.fromId)).toContain("activity:lunch-one");
    expect(proposal.view.gaps.map((gap) => gap.fromId)).not.toContain(
      visitActivityId("fixture-1"),
    );
    expect(() => commitMeals(current, proposal)).toThrow("先查询");
  });
  it("checks return constraints against dinner completion rather than the old visits-only ending", () => {
    const initial = state();
    const form = initialIntercityForm(initial);
    Object.assign(form.return, {
      enabled: true,
      origin: "测试返程站",
      destination: "测试终站",
      departure: "2026-10-18T14:00",
      arrival: "2026-10-18T21:00",
      buffer: "30",
      transfer: "45",
    });
    const current = commitIntercity(
      initial,
      previewIntercity(
        initial,
        buildIntercityForm(initial, form, "2026-10-14T01:00:00Z"),
      ),
    );
    const proposal = previewMeals(current, completed(current, setup(1)));
    expect(proposal.view.conflicts.join(" ")).toContain("返程约束");
    proposal.view.conflicts = [];
    proposal.view.draft.status = "unverified";
    expect(() => commitMeals(current, proposal)).toThrow("时间或锁定冲突");
  });
  it("removes meals explicitly, preserves budget, and undo restores meal identities and original query clocks", () => {
    const current = saved();
    const changed = commitMeals(current, previewMeals(current, emptyMeals()));
    expect(changed.meals).toEqual(emptyMeals());
    const emptyPreview = previewMeals(changed, emptyMeals());
    emptyPreview.view.draft.days[0].items[0].place.name = "must stay isolated";
    expect(changed.draft.days[0].items[0].place.name).not.toBe("must stay isolated");
    expect(changed.budget).toEqual(current.budget);
    expect(undoEdit(changed).meals).toEqual(current.meals);
    expect(
      deriveMealTrip(changed.draft, changed.locks, changed.meals).draft.days[0].items,
    ).toHaveLength(2);
  });
  it("runtime-validates the store and resets meals on a new plan without persisting derived timelines", () => {
    useDraftEditor.getState().start(fixtureDraft());
    const current = useDraftEditor.getState().current!;
    const proposal = previewMeals(current, completed(current));
    proposal.setup.days[0].entries[0].meal.perPersonFen = -1;
    expect(() => useDraftEditor.getState().confirmMeals(proposal)).toThrow();
    expect(useDraftEditor.getState().current).toBe(current);
    const valid = previewMeals(current, completed(current));
    useDraftEditor.getState().confirmMeals(valid);
    expect(useDraftEditor.getState().current!.meals.days).toHaveLength(1);
    useDraftEditor.getState().start(fixtureDraft());
    expect(useDraftEditor.getState().current!.meals).toEqual(emptyMeals());
    expect(() => useDraftEditor.getState().confirmMeals(valid)).toThrow("行程已变化");
    useDraftEditor.getState().reset();
  });
  it("rejects ambiguous setup IDs, reserved visit IDs and absent route request coordinates", () => {
    const input = completed();
    expect(mealSetupSchema.safeParse(JSON.parse(JSON.stringify(input))).success).toBe(
      true,
    );
    expect(
      mealSetupSchema.safeParse({ ...input, days: [input.days[0], input.days[0]] })
        .success,
    ).toBe(false);
    expect(
      mealSetupSchema.safeParse({ days: [], connections: input.connections }).success,
    ).toBe(false);
    const reserved = structuredClone(input);
    reserved.days[0].entries[0].id = visitActivityId("fixture-0");
    expect(mealSetupSchema.safeParse(reserved).success).toBe(false);
    const noCoordinates = { ...input.connections[0], origin: undefined };
    expect(
      mealSetupSchema.safeParse({ ...input, connections: [noCoordinates] }).success,
    ).toBe(false);
    expect(visitActivityId("a-b")).not.toBe(visitActivityId("ab"));
    expect(visitActivityId("站点😀")).toMatch(/^activity:visit-[a-f0-9]+$/);
  });
  it("retains known intercity conflicts in the sanitized derived share without exposing train/station details", () => {
    const current = saved();
    const form = initialIntercityForm(current);
    Object.assign(form.return, {
      enabled: true,
      number: "PRIVATE-RETURN",
      origin: "私人返程站",
      destination: "私人到达站",
      departure: "2026-10-18T09:00",
      arrival: "2026-10-18T20:00",
      buffer: "",
      transfer: "",
    });
    const conflict = commitIntercity(
      current,
      previewIntercity(
        current,
        buildIntercityForm(current, form, "2026-10-14T01:00:00Z"),
      ),
      true,
    );
    expect(buildShareSnapshot(conflict).status).toBe("infeasible");
    expect(JSON.stringify(buildShareSnapshot(conflict))).not.toMatch(
      /PRIVATE-RETURN|私人返程站/,
    );
  });
  it("includes meal provider data in retention gates and keeps meal private facts out of the share DTO", () => {
    const current = saved();
    current.meals.days[0].entries[0].place.source = {
      ...source,
      kind: "provider",
      provider: "amap",
    };
    current.meals.connections[0].route!.source = {
      ...source,
      kind: "provider",
      provider: "amap",
    };
    const now = Date.parse("2026-10-13T00:10:00Z");
    const expires = new Date(now + 86_400_000);
    const options = { now, allowFixture: true };
    const permission = {
      evidenceReference: "test-only, not a real data license",
      validUntil: "2026-10-14T00:00:00Z",
      maxAgeMs: 3_600_000,
      places: true,
      routes: true,
    };
    expect(() => storageExpiry(current, expires, null, options)).toThrow("保存权限");
    expect(() =>
      storageExpiry(current, expires, { ...permission, routes: false }, options),
    ).toThrow("保存权限");
    expect(storageExpiry(current, expires, permission, options).getTime()).toBe(
      Date.parse(source.queriedAt) + permission.maxAgeMs,
    );
    const dto = buildShareSnapshot(current);
    expect(dto.days[0].items).toHaveLength(4);
    expect(dto.days[0].items[2].startMinute).toBe(785);
    const text = JSON.stringify(dto);
    for (const field of [
      "private-food-address",
      "私密",
      "afterPlaceId",
      "perPersonFen",
      "dietaryCheck",
      "activity:lunch-one",
      "recordedAt",
    ]) {
      expect(text).not.toContain(field);
    }
    expect(dto.fixture).toBe(true);
  });
});

describe("one directed query/merge proposal for visits plus meal instances", () => {
  it("queries only the actual new dinner-to-visit edge, not the bypassed visit-to-visit edge", () => {
    const current = afterSecondVisit();
    const original = structuredClone(current);
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(proposal.gaps.map((gap) => [gap.fromId, gap.toId])).toEqual([
      ["meal-dinner", "fixture-0"],
    ]);
    expect(proposal.gaps[0].fromActivityId).toBe("activity:dinner-one");
    expect(proposal.gaps[0].toActivityId).toBe(visitActivityId("fixture-0"));
    const resolved = resolveEdit(current, proposal, [structuredClone(route)]);
    expect(resolved.conflicts).toEqual([]);
    const changed = commitEdit(current, resolved);
    expect(changed.draft.days[0].legs[0].route).toBeNull();
    expect(deriveMealTrip(changed.draft, changed.locks, changed.meals).gaps).toEqual([]);
    expect(resolved.effectiveDraft.days[0].items.map((item) => item.startMinute)).toEqual(
      [540, 690, 1050, 1145],
    );
    expect(resolved.effectiveDraft.days[0].items[3].endMinute).toBe(1235);
    expect(changed.meals.connections).toHaveLength(3);
    expect(changed.meals.connections[0]).toEqual(current.meals.connections[0]);
    expect(changed.meals.connections[1]).toEqual(current.meals.connections[1]);
    expect(changed.budget).toEqual(current.budget);
    expect(current).toEqual(original);
    expect(undoEdit(changed).meals).toEqual(current.meals);
  });
  it("rejects missing/extra route vectors and recomputes authoritative gaps instead of trusting preview edits", () => {
    const current = afterSecondVisit();
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(() => resolveEdit(current, proposal, [])).toThrow("路段不一致");
    expect(() => resolveEdit(current, proposal, [route, route])).toThrow("路段不一致");
    proposal.gaps[0].fromActivityId = visitActivityId("forged");
    proposal.gaps[0].origin[0] = 100;
    proposal.meals = emptyMeals();
    proposal.effectiveDraft.days[0].items = [];
    const checked = resolveEdit(current, proposal, [structuredClone(route)]);
    expect(checked.gaps[0].fromActivityId).toBe("activity:dinner-one");
    expect(checked.meals.days).toHaveLength(1);
    expect(checked.effectiveDraft.days[0].items).toHaveLength(4);
    expect(current.meals.connections[1].origin[0]).not.toBe(100);
  });
  it("separates lunch/dinner/visit instances at the same POI and does not invent zero-minute transfers", () => {
    const current = afterSecondVisit(true);
    const before = deriveMealTrip(current.draft, current.locks, current.meals);
    expect(before.draft.days[0].items.slice(1).map((item) => item.place.id)).toEqual([
      "fixture-1",
      "fixture-1",
      "fixture-1",
    ]);
    expect(new Set(before.draft.days[0].items.map((item) => item.activityId)).size).toBe(
      4,
    );
    expect(before.draft.days[0].legs[1].route?.seconds).toBe(1200);
    expect(current.meals.connections).toHaveLength(2);
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(proposal.gaps).toHaveLength(1);
    expect(proposal.gaps[0].fromId).toBe("fixture-1");
    expect(proposal.gaps[0].fromActivityId).toBe("activity:dinner-one");
    const changed = commitEdit(
      current,
      resolveEdit(current, proposal, [structuredClone(route)]),
    );
    expect(changed.meals.connections).toHaveLength(3);
    expect(
      changed.meals.connections.map((leg) => [leg.fromActivityId, leg.toActivityId]),
    ).toContainEqual(["activity:lunch-one", "activity:dinner-one"]);
  });
  it("merges cross-day visit edges in the same proposal while preserving unaffected meal directions and clocks", () => {
    const current = afterSecondVisit();
    const proposal = previewEdit(current, {
      placeId: "fixture-0",
      toDay: 1,
      toIndex: 1,
      stayMinutes: 90,
    });
    expect(proposal.gaps.map((gap) => [gap.fromId, gap.toId])).toEqual([
      ["fixture-2", "fixture-0"],
      ["fixture-0", "fixture-3"],
    ]);
    const changed = commitEdit(
      current,
      resolveEdit(current, proposal, [structuredClone(route), structuredClone(route)]),
    );
    expect(changed.meals).toEqual(current.meals);
    expect(changed.draft.days[1].legs.map((leg) => leg.route?.seconds)).toEqual([
      1200, 1200,
    ]);
    expect(deriveMealTrip(changed.draft, changed.locks, changed.meals).gaps).toEqual([]);
    expect(
      deriveMealTrip(changed.draft, changed.locks, changed.meals).draft.days[0].items.map(
        (item) => item.purpose,
      ),
    ).toEqual(["visit", "lunch", "dinner"]);
  });
  it("queries a deferred bypass only when meals are explicitly removed, promotes it into the visit skeleton, and undoes", () => {
    const current = reorderWithMeals();
    const proposal = previewMeals(current, emptyMeals());
    expect(proposal.view.gaps.map((gap) => [gap.fromId, gap.toId])).toEqual([
      [visitActivityId("fixture-1"), visitActivityId("fixture-0")],
    ]);
    expect(() => commitMeals(current, proposal)).toThrow("先查询");
    const resolved = resolveMeals(current, proposal, [structuredClone(route)]);
    expect(mealSetupSchema.safeParse(resolved.setup).success).toBe(true);
    expect(resolved.view.gaps).toEqual([]);
    const changed = commitMeals(current, resolved);
    expect(changed.meals).toEqual(emptyMeals());
    expect(changed.draft.days[0].legs[0].route?.seconds).toBe(1200);
    expect(changed.draft.days[0].items[1].startMinute).toBe(665);
    expect(changed.budget).toEqual(current.budget);
    const restored = undoEdit(changed);
    expect(restored.meals).toEqual(current.meals);
    expect(restored.draft).toEqual(current.draft);
    expect(deriveMealTrip(restored.draft, restored.locks, restored.meals).gaps).toEqual(
      [],
    );
  });
  it("meal route merging rejects incomplete/stale data and ignores tampered gap metadata", () => {
    const current = state();
    const proposal = previewMeals(current, setup());
    expect(() => resolveMeals(current, proposal, [route])).toThrow("路段不一致");
    const changed = toggleStopLock(current, "fixture-0", "position");
    expect(() => resolveMeals(changed, proposal, [route, route, route])).toThrow(
      "行程已变化",
    );
    proposal.view.gaps[0].fromId = "activity:forged";
    proposal.view.gaps[0].origin[0] = 100;
    const resolved = resolveMeals(current, proposal, [
      structuredClone(route),
      structuredClone(route),
      structuredClone(route),
    ]);
    expect(resolved.setup.connections[0].fromActivityId).toBe(
      visitActivityId("fixture-0"),
    );
    expect(resolved.setup.connections[0].origin).toEqual(
      current.draft.days[0].items[0].place.location,
    );
    expect(commitMeals(current, resolved).meals.days).toHaveLength(1);
    expect(current.meals).toEqual(emptyMeals());
  });
  it("retains the full post-dinner time lock and rejects an increased dinner duration without querying unchanged edges", () => {
    const current = toggleStopLock(reorderWithMeals(), "fixture-0", "time");
    expect(current.locks["fixture-0"].time?.minute).toBe(1145);
    const input = structuredClone(current.meals);
    input.days[0].entries[1].stayMinutes = 90;
    const proposal = previewMeals(current, input);
    expect(proposal.view.gaps).toEqual([]);
    expect(proposal.view.conflicts.length).toBeGreaterThan(0);
    expect(() => commitMeals(current, proposal)).toThrow("锁定冲突");
    expect(current.meals.days[0].entries[1].stayMinutes).toBe(60);
  });
  it("removing the last meals still enforces the full-timeline position lock after the replacement visit route resolves", () => {
    const current = toggleStopLock(reorderWithMeals(), "fixture-0", "position");
    expect(current.locks["fixture-0"].position?.index).toBe(3);
    const resolved = resolveMeals(current, previewMeals(current, emptyMeals()), [
      structuredClone(route),
    ]);
    expect(resolved.view.conflicts.join(" ")).toContain("完整行程位置已锁定");
    expect(() => commitMeals(current, resolved)).toThrow("锁定冲突");
    expect(current.meals.days).toHaveLength(1);
  });
  it("unknown replacement route durations do not recover a locked downstream clock or silently unlock it", () => {
    const current = toggleStopLock(reorderWithMeals(), "fixture-0", "time");
    const input = structuredClone(current.meals);
    input.days[0].entries[1].place.location[0] += 0.01;
    const proposal = previewMeals(current, input);
    expect(proposal.view.gaps).toHaveLength(2);
    expect(proposal.view.conflicts).toEqual([]);
    const compatible = resolveMeals(current, proposal, [
      structuredClone(route),
      structuredClone(route),
    ]);
    expect(compatible.view.conflicts).toEqual([]);
    expect(commitMeals(current, compatible).locks).toEqual(current.locks);
    const unknown = { ...structuredClone(route), seconds: null };
    const resolved = resolveMeals(current, proposal, [unknown, unknown]);
    expect(resolved.view.gaps).toEqual([]);
    expect(resolved.view.draft.days[0].items[3].startMinute).toBeNull();
    expect(() => commitMeals(current, resolved)).toThrow("锁定冲突");
    expect(current.locks["fixture-0"].time?.minute).toBe(1145);
  });
});

function reservedMeals(fixedStartMinute: number | null = null) {
  const current = saved();
  const input = structuredClone(current.meals);
  input.days[0].entries[0].fixedStartMinute = fixedStartMinute;
  input.days[0].entries[0].rules = {
    date: input.days[0].date,
    openingWindows: [{ startMinute: 480, endMinute: 1320 }],
    lastEntryMinute: 1200,
    reservation: {
      state: "confirmed",
      entryWindow: { startMinute: 690, endMinute: 720 },
    },
    source: { kind: "user", recordedAt: "2026-10-14T01:30:00Z" },
  };
  return commitMeals(current, previewMeals(current, input));
}

describe("reservation release must be checked below the form", () => {
  it("does not allow a raw meal setup to clear a confirmed reservation without explicit release", () => {
    const current = reservedMeals();
    const input = structuredClone(current.meals);
    input.days[0].entries[0].rules = null;
    const original = structuredClone(current);
    expect(() => commitMeals(current, previewMeals(current, input))).toThrow("预约");
    expect(current).toEqual(original);
  });
  it("does not allow raw removal of all meals to silently drop a confirmed reservation", () => {
    const current = reservedMeals();
    expect(() => commitMeals(current, previewMeals(current, emptyMeals()))).toThrow(
      "预约",
    );
    expect(current.meals.days[0].entries[0].rules?.reservation.state).toBe("confirmed");
  });
  it("recomputes reservation releases even if a caller clears the displayed conflicts", () => {
    const current = reservedMeals();
    const proposal = previewMeals(current, current.meals);
    proposal.setup.days[0].entries[0].rules = null;
    proposal.view.conflicts = [];
    proposal.view.draft.status = "unverified";
    expect(() => commitMeals(current, proposal)).toThrow("预约");
  });
  it("binds explicit release to before/after data, preserves immutable snapshots and undoes without persisting acknowledgements", () => {
    const current = reservedMeals();
    const original = structuredClone(current);
    const input = structuredClone(current.meals);
    input.days[0].entries[0].rules = null;
    const releases = mealReservationReleases(current.meals, input);
    expect(releases).toHaveLength(1);
    expect(releases[0].activityId).toBe("activity:lunch-one");
    const proposal = previewMeals(current, input, releases);
    releases[0].afterKey = "mutated outside proposal";
    expect(proposal.reservationReleases[0].afterKey).not.toBe(releases[0].afterKey);
    const next = commitMeals(current, proposal);
    expect(next.meals.days[0].entries[0].rules).toBeNull();
    expect(next.version).toBe(current.version + 1);
    expect(undoEdit(next).meals).toEqual(current.meals);
    expect(JSON.stringify(next)).not.toContain("beforeKey");
    expect(current).toEqual(original);
  });
  it("rejects stale keys, unrelated activities, duplicate and extra acknowledgements at domain and store boundaries", () => {
    const current = reservedMeals();
    const input = structuredClone(current.meals);
    input.days[0].entries[0].rules = null;
    const [release] = mealReservationReleases(current.meals, input);
    for (const invalid of [
      [{ ...release, beforeKey: "changed" }],
      [{ ...release, afterKey: "changed" }],
      [{ ...release, activityId: "activity:dinner-one" }],
      [release, release],
      [{ ...release, ownerId: "not-a-permission" }],
    ]) {
      expect(() => previewMeals(current, input, invalid)).toThrow("预约变更核对");
    }
    expect(mealReservationReleasesSchema.safeParse(null).success).toBe(false);
    expect(mealReservationReleasesSchema.safeParse([release, release]).success).toBe(
      false,
    );
    expect(
      mealReservationReleasesSchema.safeParse([{ ...release, receipt: "forbidden" }])
        .success,
    ).toBe(false);
    expect(
      mealReservationReleasesSchema.safeParse([
        { ...release, beforeKey: "x".repeat(4097) },
      ]).success,
    ).toBe(false);
    expect(() => previewMeals(current, current.meals, [release])).toThrow("预约变更核对");
    const proposal = previewMeals(current, input, [release]);
    useDraftEditor.setState({ current });
    try {
      proposal.reservationReleases[0].afterKey = "changed";
      expect(() => useDraftEditor.getState().confirmMeals(proposal)).toThrow(
        "预约变更核对",
      );
      expect(useDraftEditor.getState().current).toBe(current);
    } finally {
      useDraftEditor.getState().reset();
    }
  });
  it("detects changes to the actual day, rule date, venue identity, activity identity and exact appointment window", () => {
    const current = reservedMeals();
    const candidates = Array.from({ length: 6 }, () => structuredClone(current.meals));
    candidates[0].days[0].date = "2026-10-18";
    candidates[1].days[0].entries[0].rules!.date = "2026-10-18";
    candidates[2].days[0].entries[0].place.id = "another-restaurant";
    candidates[3].days[0].entries[0].place.location[0] += 0.001;
    candidates[4].days[0].entries[0].id = "activity:replacement-lunch";
    candidates[5].days[0].entries[0].rules!.reservation.entryWindow!.endMinute += 1;
    const keys = candidates.map((candidate) =>
      mealReservationReleases(current.meals, candidate),
    );
    for (const releases of keys) {
      expect(releases).toHaveLength(1);
    }
    expect(new Set(keys.map((items) => items[0].afterKey)).size).toBe(6);
  });
  it("does not require release for unchanged appointment semantics when unrelated facts, prices or stay change", () => {
    const current = reservedMeals();
    const input = structuredClone(current.meals);
    const lunch = input.days[0].entries[0];
    lunch.meal.perPersonFen = 220;
    lunch.stayMinutes = 45;
    lunch.rules!.lastEntryMinute = 1201;
    lunch.rules!.source.recordedAt = "2026-10-15T01:30:00Z";
    expect(mealReservationReleases(current.meals, input)).toEqual([]);
    expect(
      commitMeals(current, previewMeals(current, input)).meals.days[0].entries[0].rules
        ?.reservation.state,
    ).toBe("confirmed");
  });
  it("requires separate acknowledgements for same-POI lunch and dinner and accepts their complete removal only explicitly", () => {
    const base = reservedMeals();
    const input = structuredClone(base.meals);
    input.days[0].entries[1].place = structuredClone(input.days[0].entries[0].place);
    input.days[0].entries[1].rules = structuredClone(input.days[0].entries[0].rules);
    input.days[0].entries[1].rules!.reservation.entryWindow = {
      startMinute: 1050,
      endMinute: 1080,
    };
    let proposal = previewMeals(base, input);
    proposal = resolveMeals(
      base,
      proposal,
      proposal.view.gaps.map(() => structuredClone(route)),
    );
    const current = commitMeals(base, proposal);
    const releases = mealReservationReleases(current.meals, emptyMeals());
    expect(releases).toHaveLength(2);
    expect(
      previewMeals(current, emptyMeals(), releases.slice(0, 1)).view.conflicts.join(" "),
    ).toContain("晚餐");
    expect(() =>
      commitMeals(current, previewMeals(current, emptyMeals(), releases.slice(0, 1))),
    ).toThrow("预约");
    const removed = commitMeals(current, previewMeals(current, emptyMeals(), releases));
    expect(removed.meals.days).toEqual([]);
    expect(undoEdit(removed).meals).toEqual(current.meals);
  });
  it("carries bound acknowledgements through only affected route resolution and rejects target changes afterward", () => {
    const current = reservedMeals();
    const input = structuredClone(current.meals);
    input.days[0].entries[0].place.location[0] += 0.01;
    input.days[0].entries[0].rules = null;
    const releases = mealReservationReleases(current.meals, input);
    const proposal = previewMeals(current, input, releases);
    expect(proposal.view.gaps).toHaveLength(2);
    const resolved = resolveMeals(current, proposal, [
      structuredClone(route),
      structuredClone(route),
    ]);
    expect(resolved.reservationReleases).toEqual(releases);
    expect(commitMeals(current, resolved).meals.days[0].entries[0].rules).toBeNull();
    proposal.reservationReleases = [];
    expect(() => resolveMeals(current, proposal, [route, route])).toThrow("预约");
    resolved.setup.days[0].entries[0].place.location[0] += 0.01;
    expect(() => commitMeals(current, resolved)).toThrow("预约变更核对");
  });
  it("rechecks the current reservation and version/session rather than trusting earlier consent", () => {
    const current = reservedMeals();
    const input = structuredClone(current.meals);
    input.days[0].entries[0].rules = null;
    const proposal = previewMeals(
      current,
      input,
      mealReservationReleases(current.meals, input),
    );
    const altered = structuredClone(current);
    altered.meals.days[0].entries[0].rules!.reservation.entryWindow!.endMinute += 1;
    expect(() => commitMeals(altered, proposal)).toThrow("预约变更核对");
    for (const stale of [
      commitBudget(current, previewBudget(current, current.budget)),
      undoEdit(current),
      { ...current, sessionId: "other-session" },
    ]) {
      expect(() => commitMeals(stale, proposal)).toThrow("行程已变化");
    }
  });
  it("also binds the fixed start of a recorded appointment rather than only its broader entry window", () => {
    const current = reservedMeals(690);
    const input = structuredClone(current.meals);
    input.days[0].entries[0].fixedStartMinute = null;
    expect(() => commitMeals(current, previewMeals(current, input))).toThrow("预约");
    const releases = mealReservationReleases(current.meals, input);
    expect(releases).toHaveLength(1);
    const next = commitMeals(current, previewMeals(current, input, releases));
    expect(next.meals.days[0].entries[0].fixedStartMinute).toBeNull();
    expect(current.meals.days[0].entries[0].fixedStartMinute).toBe(690);
  });
  it("cannot use a valid appointment release to bypass a downstream time lock or a tampered report", () => {
    const current = toggleStopLock(reservedMeals(), "fixture-1", "time");
    const input = structuredClone(current.meals);
    input.days[0].entries[0].rules = null;
    input.days[0].entries[0].window.startMinute = 720;
    const proposal = previewMeals(
      current,
      input,
      mealReservationReleases(current.meals, input),
    );
    proposal.view.conflicts = [];
    proposal.view.draft.status = "unverified";
    expect(() => commitMeals(current, proposal)).toThrow("锁定冲突");
    expect(current.meals.days[0].entries[0].rules?.reservation.state).toBe("confirmed");
  });
});

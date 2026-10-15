import { describe, expect, it } from "vitest";
import {
  commitBudget,
  commitEdit,
  commitIntercity,
  createEditState,
  previewBudget,
  previewEdit,
  previewIntercity,
  resolveEdit,
  toggleStopLock,
  undoEdit,
} from "@/domain/editing";
import {
  evaluateIntercity,
  parseShanghaiLocalDateTime,
  roundTripFareFen,
} from "@/domain/intercity";
import {
  buildIntercityForm,
  initialIntercityForm,
} from "@/features/planner/intercity-form";
import { useDraftEditor } from "@/features/planner/editor-store";
import { storageExpiry } from "@/server/security/storage-policy";
import { buildShareSnapshot } from "@/server/security/share-snapshot";
import { fixtureDraft, route, source } from "../fixtures/draft";

const recordedAt = "2026-10-14T01:00:00.000Z";
function state() {
  return createEditState(structuredClone(fixtureDraft()), "intercity-session");
}
function setup(base = state()) {
  const form = initialIntercityForm(base);
  Object.assign(form.arrival, {
    enabled: true,
    number: "TEST-PRIVATE-001",
    origin: "私人出发站",
    destination: "私人到达站",
    departure: "2026-10-16T23:40",
    arrival: "2026-10-17T07:30",
    buffer: "20",
    transfer: "50",
    fare: "1.10",
  });
  Object.assign(form.return, {
    enabled: true,
    number: "TEST002",
    origin: "返程出发站",
    destination: "返程到达站",
    departure: "2026-10-18T14:00",
    arrival: "2026-10-18T21:30",
    buffer: "30",
    transfer: "45",
  });
  return buildIntercityForm(base, form, recordedAt);
}

describe("manual intercity editor integration, not server authorization", () => {
  it("requires both roles and both fares, preserves explicit zero and exact integer-fen sums", () => {
    const segments = setup().segments;
    expect(roundTripFareFen([])).toBeNull();
    expect(roundTripFareFen(segments.slice(0, 1))).toBeNull();
    expect(roundTripFareFen([segments[0], segments[0]])).toBeNull();
    expect(roundTripFareFen(segments)).toBeNull();
    segments[1].farePerPersonFen = 220;
    const before = structuredClone(segments);
    expect(roundTripFareFen(segments)).toBe(330);
    expect(segments).toEqual(before);
    segments[0].farePerPersonFen = 0;
    segments[1].farePerPersonFen = 0;
    expect(roundTripFareFen(segments)).toBe(0);
    segments[0].farePerPersonFen = 6_000_000;
    segments[1].farePerPersonFen = 6_000_000;
    expect(roundTripFareFen(segments)).toBe(12_000_000);
  });
  it("explicit fare replacement uses normal budget preview/version/undo without adding twice or changing trips/locks", () => {
    const initial = toggleStopLock(state(), "fixture-0", "position");
    const data = setup(initial);
    data.segments[1].farePerPersonFen = 220;
    const base = commitIntercity(initial, previewIntercity(initial, data));
    const budget = structuredClone(base.budget);
    budget.includeIntercity = false;
    budget.items.intercity = {
      amountFen: roundTripFareFen(base.intercity.segments),
      basis: "per_person",
      source: { kind: "user", recordedAt },
    };
    const proposal = previewBudget(base, budget);
    expect(base.budget.items.intercity.amountFen).toBeNull();
    const confirmed = commitBudget(base, proposal);
    expect(confirmed.budget.items.intercity.amountFen).toBe(330);
    expect(confirmed.budget.includeIntercity).toBe(false);
    expect(confirmed.budget.items.meals).toEqual(base.budget.items.meals);
    expect(confirmed.intercity).toEqual(base.intercity);
    expect(confirmed.locks).toEqual(base.locks);
    expect(confirmed.draft).toEqual(base.draft);
    expect(undoEdit(confirmed).budget).toEqual(base.budget);
    expect(() => commitBudget(confirmed, proposal)).toThrow("行程已变化");
  });
  it("previews without mutating state, commits dated manual data, preserves locks/budget and undoes as a new version", () => {
    const base = toggleStopLock(state(), "fixture-0", "position");
    const data = setup(base);
    const proposal = previewIntercity(base, data);
    data.segments[0].origin.name = "changed after preview";
    expect(base.intercity.segments).toEqual([]);
    expect(proposal.setup.segments[0].origin.name).toBe("私人出发站");
    const changed = commitIntercity(base, proposal);
    expect(changed.version).toBe(base.version + 1);
    expect(changed.locks).toEqual(base.locks);
    expect(changed.draft).toEqual(base.draft);
    expect(changed.budget).toEqual(base.budget);
    expect(changed.intercity.segments[0].farePerPersonFen).toBe(110);
    expect(changed.intercity.segments[1].farePerPersonFen).toBeNull();
    expect(changed.intercity.connections.arrival?.source.kind).toBe("user");
    const undone = undoEdit(changed);
    expect(undone.version).toBe(changed.version + 1);
    expect(undone.intercity).toEqual(base.intercity);
    expect(undone.locks).toEqual(base.locks);
  });
  it("recomputes tampered preview reports and requires explicit conflict-draft acknowledgement", () => {
    const base = state();
    const data = setup(base);
    data.segments[0].arrivalAt = parseShanghaiLocalDateTime("2026-10-17T10:00");
    const proposal = previewIntercity(base, data);
    expect(proposal.report.status).toBe("infeasible");
    proposal.report.status = "unverified";
    proposal.report.checks = [];
    expect(() => commitIntercity(base, proposal)).toThrow("仅记录含冲突");
    const saved = commitIntercity(base, proposal, true);
    expect(
      evaluateIntercity(
        saved.draft,
        saved.intercity.segments,
        saved.intercity.connections,
      ).status,
    ).toBe("infeasible");
    expect(base.intercity.segments).toHaveLength(0);
  });
  it("rejects stale/cross-session previews after locks, costs, confirmation or undo", () => {
    const base = state();
    const proposal = previewIntercity(base, setup(base));
    const changed = commitIntercity(base, proposal);
    for (const current of [
      changed,
      undoEdit(changed),
      toggleStopLock(base, "fixture-0", "time"),
      commitBudget(base, previewBudget(base, base.budget)),
      createEditState(base.draft, "other"),
    ]) {
      expect(() => commitIntercity(current, proposal)).toThrow("行程已变化");
    }
  });
  it("revalidates intercity bounds for later stay edits and cannot bypass conflicts by tampering the candidate", () => {
    const base = state();
    const saved = commitIntercity(base, previewIntercity(base, setup(base)));
    const proposal = previewEdit(saved, {
      placeId: "fixture-3",
      toDay: 1,
      toIndex: 1,
      stayMinutes: 120,
    });
    expect(proposal.conflicts.join()).toContain("到达／返程");
    proposal.conflicts = [];
    proposal.draft.status = "unverified";
    expect(() => commitEdit(saved, proposal)).toThrow("时间或锁定冲突");
  });
  it("does not relabel old transfer estimates after an endpoint change; unchanged timestamps stay unchanged", () => {
    const base = state();
    const saved = commitIntercity(base, previewIntercity(base, setup(base)));
    const same = buildIntercityForm(
      saved,
      initialIntercityForm(saved),
      "2026-10-14T02:00:00.000Z",
    );
    expect(same).toEqual(saved.intercity);
    const proposal = previewEdit(saved, {
      placeId: "fixture-0",
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    const moved = commitEdit(
      saved,
      resolveEdit(saved, proposal, [structuredClone(route)]),
    );
    expect(
      evaluateIntercity(
        moved.draft,
        moved.intercity.segments,
        moved.intercity.connections,
      ).checks[0].state,
    ).toBe("unknown");
    const form = initialIntercityForm(moved);
    expect(form.arrival.transfer).toBe("");
    expect(buildIntercityForm(moved, form, recordedAt).connections.arrival).toBeNull();
  });
  it("validates optional numbers without converting blanks or invalid values to zero", () => {
    const base = state();
    const saved = commitIntercity(base, previewIntercity(base, setup(base)));
    for (const key of ["buffer", "transfer", "fare"] as const) {
      const form = initialIntercityForm(saved);
      form.arrival[key] = "-1";
      expect(() => buildIntercityForm(saved, form, recordedAt)).toThrow();
    }
    const form = initialIntercityForm(saved);
    form.arrival.buffer = "";
    form.arrival.transfer = "";
    form.arrival.fare = "0";
    const result = buildIntercityForm(saved, form, recordedAt);
    expect(result.segments[0]).toMatchObject({
      terminalBufferMinutes: null,
      farePerPersonFen: 0,
    });
    expect(result.connections.arrival).toBeNull();
    form.arrival.origin = "新的车站";
    expect(buildIntercityForm(saved, form, recordedAt).segments[0].origin.id).not.toBe(
      saved.intercity.segments[0].origin.id,
    );
  });
  it("runtime-validates the client store and resets cross-plan data", () => {
    useDraftEditor.getState().start(fixtureDraft());
    const current = useDraftEditor.getState().current;
    if (!current) {
      throw new Error("Missing editor");
    }
    const proposal = previewIntercity(current, setup(current));
    const invalid = {
      ...proposal,
      setup: { ...proposal.setup, ownerId: "not-authority" },
    };
    expect(() => useDraftEditor.getState().confirmIntercity(invalid, false)).toThrow();
    expect(useDraftEditor.getState().current?.version).toBe(0);
    useDraftEditor.getState().confirmIntercity(proposal, false);
    expect(useDraftEditor.getState().current?.intercity.segments).toHaveLength(2);
    useDraftEditor.getState().start(fixtureDraft());
    expect(useDraftEditor.getState().current?.intercity.segments).toHaveLength(0);
    useDraftEditor.getState().reset();
  });
  it("extends retention gates to provider transfer sources and never copies private stations/tickets into sharing", () => {
    const base = state();
    base.intercity = setup(base);
    const transfer = base.intercity.connections.arrival;
    if (!transfer) {
      throw new Error("Missing test transfer");
    }
    transfer.source = { ...source, kind: "provider", provider: "amap" };
    const now = Date.parse("2026-10-13T00:10:00Z");
    const expires = new Date(now + 86_400_000);
    const options = { now, allowFixture: true };
    expect(() => storageExpiry(base, expires, null, options)).toThrow();
    const permission = {
      evidenceReference: "test only, not supplier permission",
      validUntil: "2026-10-14T00:00:00Z",
      maxAgeMs: 3_600_000,
      places: true,
      routes: true,
    };
    expect(storageExpiry(base, expires, permission, options).toISOString()).toBe(
      "2026-10-13T01:00:00.000Z",
    );
    expect(() =>
      storageExpiry(base, expires, { ...permission, routes: false }, options),
    ).toThrow();
    const shared = JSON.stringify(buildShareSnapshot(base));
    for (const text of [
      "私人出发站",
      "私人到达站",
      "TEST-PRIVATE-001",
      "intercity",
      "farePerPersonFen",
    ]) {
      expect(shared).not.toContain(text);
    }
  });
});

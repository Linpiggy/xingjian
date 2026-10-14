import { describe, expect, it } from "vitest";
import {
  commitEdit,
  createEditState,
  previewEdit,
  resolveEdit,
  toggleStopLock,
  undoEdit,
} from "@/domain/editing";
import { fixtureDraft, places, route } from "../fixtures/draft";

const makeState = () =>
  createEditState(structuredClone(fixtureDraft()), "fixture-session");
const move = { placeId: places[0].id, toDay: 0, toIndex: 1, stayMinutes: 90 };

function freeze(value: object) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      freeze(child);
    }
  }
}

describe("immutable, versioned edits of unsaved drafts", () => {
  it("previews without mutation and requests only the new directed adjacent leg", () => {
    const state = makeState();
    const original = structuredClone(state);
    freeze(state);
    const proposal = previewEdit(state, move);
    expect(state).toEqual(original);
    expect(proposal.draft.days[0].items.map((item) => item.place.id)).toEqual([
      places[1].id,
      places[0].id,
    ]);
    expect(proposal.gaps.map((gap) => [gap.fromId, gap.toId])).toEqual([
      [places[1].id, places[0].id],
    ]);
    expect(proposal.draft.days[1].legs[0]).toBe(state.draft.days[1].legs[0]);
    expect(proposal.routes).toBeNull();
    expect(proposal.draft.days[0].items[1].startMinute).toBeNull();
    expect(() => commitEdit(state, proposal)).toThrow("先查询");
  });

  it("requires confirmation even after routes resolve; undo is a new version", () => {
    const state = makeState();
    const resolved = resolveEdit(state, previewEdit(state, move), [route]);
    expect(state.version).toBe(0);
    expect(state.draft.days[0].items[0].place.id).toBe(places[0].id);
    const confirmed = commitEdit(state, resolved);
    expect(confirmed.version).toBe(1);
    expect(confirmed.draft.input.keywords).toEqual([
      places[1].name,
      places[0].name,
      places[2].name,
      places[3].name,
    ]);
    expect(confirmed.draft.days[0].items[1].startMinute).toBe(665);
    const undone = undoEdit(confirmed);
    expect(undone.version).toBe(2);
    expect(undone.draft).toEqual(state.draft);
    expect(undone.previous).toBeNull();
    expect(() => undoEdit(undone)).toThrow("没有可撤销");
  });

  it("rejects stale versions and a new plan with an equal version", () => {
    const state = makeState();
    const proposal = resolveEdit(state, previewEdit(state, move), [route]);
    const locked = toggleStopLock(state, places[2].id, "position");
    expect(() => commitEdit(locked, proposal)).toThrow("行程已变化");
    expect(() => resolveEdit(locked, proposal, [route])).toThrow("行程已变化");
    expect(() =>
      commitEdit(createEditState(fixtureDraft(), "another-session"), proposal),
    ).toThrow("行程已变化");
  });

  it("revalidates rather than trusting a modified preview draft", () => {
    const state = makeState();
    const proposal = resolveEdit(state, previewEdit(state, move), [route]);
    proposal.draft.days[0].items[0].place = { ...places[0], id: "invented-id" };
    const confirmed = commitEdit(state, proposal);
    expect(confirmed.draft.days[0].items[0].place.id).toBe(places[1].id);
  });

  it("changes stop-specific duration without requesting unchanged routes", () => {
    const state = makeState();
    const proposal = previewEdit(state, { ...move, toIndex: 0, stayMinutes: 120 });
    expect(proposal.gaps).toHaveLength(0);
    expect(proposal.routes).toEqual([]);
    const next = commitEdit(state, proposal);
    expect(next.draft.days[0].items[0].stayMinutes).toBe(120);
    expect(next.draft.days[0].items[1].stayMinutes).toBe(90);
    expect(next.draft.days[0].items[1].startMinute).toBe(695);
    expect(next.draft.days[1]).toEqual(state.draft.days[1]);
  });

  it("retains selection IDs and the user's new cross-day order", () => {
    const draft = structuredClone(fixtureDraft());
    draft.input.selections = places.map((place) => ({
      kind: "amap",
      poiId: place.id,
      keyword: "测试",
    }));
    const state = createEditState(draft, "fixture");
    const proposal = previewEdit(state, { ...move, toDay: 1, toIndex: 1 });
    expect(proposal.gaps.map((gap) => [gap.fromId, gap.toId])).toEqual([
      [places[2].id, places[0].id],
      [places[0].id, places[3].id],
    ]);
    const next = commitEdit(state, resolveEdit(state, proposal, [route, route]));
    expect(next.draft.days.map((day) => day.items.length)).toEqual([1, 3]);
    expect(
      next.draft.input.selections?.map((selection) =>
        selection.kind === "amap" ? selection.poiId : selection.id,
      ),
    ).toEqual([places[1].id, places[2].id, places[0].id, places[3].id]);
    expect(next.draft.notices[1]).toContain("按你的调整");
  });

  it("does not move a position-locked target or indirectly shift another locked stop", () => {
    for (const id of [places[0].id, places[1].id]) {
      const state = toggleStopLock(makeState(), id, "position");
      const proposal = previewEdit(state, move);
      expect(proposal.conflicts[0]).toContain("已锁定");
      expect(() => commitEdit(state, resolveEdit(state, proposal, [route]))).toThrow(
        "冲突",
      );
      expect(state.locks[id].position).toBeDefined();
    }
  });

  it("time locks permit early arrival with waiting, not a late or unknown arrival", () => {
    const state = toggleStopLock(makeState(), places[1].id, "time");
    const early = previewEdit(state, { ...move, toIndex: 0, stayMinutes: 15 });
    expect(early.conflicts).toEqual([]);
    expect(commitEdit(state, early).draft.days[0].items[1].startMinute).toBe(665);
    const late = previewEdit(state, { ...move, toIndex: 0, stayMinutes: 240 });
    expect(late.conflicts[0]).toContain("锁定时间");
    expect(() => commitEdit(state, late)).toThrow("冲突");
    const reordered = previewEdit(state, {
      placeId: places[2].id,
      toDay: 0,
      toIndex: 1,
      stayMinutes: 90,
    });
    const unknown = resolveEdit(state, reordered, [{ ...route, seconds: null }, route]);
    expect(unknown.conflicts[0]).toContain("锁定时间");
  });

  it("time locks include the date, and unknown start times cannot be locked", () => {
    const state = toggleStopLock(makeState(), places[0].id, "time");
    expect(previewEdit(state, { ...move, toDay: 1, toIndex: 0 }).conflicts[0]).toContain(
      "锁定时间",
    );
    const unknown = fixtureDraft();
    unknown.days[0].items[1].startMinute = null;
    expect(() =>
      toggleStopLock(createEditState(unknown, "unknown"), places[1].id, "time"),
    ).toThrow("未知时间");
  });

  it("unlocking is explicit and preserves the other kind of lock", () => {
    let state = toggleStopLock(makeState(), places[0].id, "position");
    state = toggleStopLock(state, places[0].id, "time");
    state = toggleStopLock(state, places[0].id, "position");
    expect(state.locks[places[0].id].position).toBeUndefined();
    expect(state.locks[places[0].id].time).toBeDefined();
    expect(state.version).toBe(3);
  });

  it.each([
    { ...move, placeId: "absent" },
    { ...move, toDay: -1 },
    { ...move, toDay: 0.5 },
    { ...move, toIndex: -1 },
    { ...move, toIndex: 99 },
    { ...move, stayMinutes: 14 },
    { ...move, stayMinutes: 241 },
    { ...move, stayMinutes: 15.5 },
    { ...move, toIndex: 0 },
  ])("rejects invalid edits without changing the draft: %j", (operation) => {
    const state = makeState();
    const before = structuredClone(state);
    expect(() => previewEdit(state, operation)).toThrow();
    expect(state).toEqual(before);
  });

  it("rejects empty days and mismatched route counts", () => {
    const state = makeState();
    const moved = commitEdit(
      state,
      resolveEdit(state, previewEdit(state, { ...move, toDay: 1, toIndex: 2 }), [route]),
    );
    expect(() =>
      previewEdit(moved, {
        placeId: places[1].id,
        toDay: 1,
        toIndex: 0,
        stayMinutes: 90,
      }),
    ).toThrow("至少保留一个");
    expect(() => resolveEdit(state, previewEdit(state, move), [])).toThrow("不一致");
  });

  it("rejects overflow and never presents missing prices as budget savings", () => {
    const state = makeState();
    const proposal = previewEdit(state, {
      ...move,
      toDay: 1,
      toIndex: 2,
      stayMinutes: 240,
    });
    const resolved = resolveEdit(state, proposal, [{ ...route, seconds: 8 * 3600 }]);
    expect(resolved.draft.status).toBe("infeasible");
    expect(() => commitEdit(state, resolved)).toThrow("冲突");
    expect(resolved.draft.input.budgetPerPersonFen).toBe(
      state.draft.input.budgetPerPersonFen,
    );
  });
});

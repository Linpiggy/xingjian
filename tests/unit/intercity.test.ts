import { describe, expect, it, vi } from "vitest";
import {
  atShanghaiMinute,
  evaluateIntercity,
  parseShanghaiLocalDateTime,
  type IntercityConnection,
  type ManualIntercitySegment,
} from "@/domain/intercity";
import {
  intercitySegmentsSchema,
  manualIntercitySchema,
} from "@/lib/intercity-contracts";
import { fixtureDraft, source } from "../fixtures/draft";

function arrival(): ManualIntercitySegment {
  return manualIntercitySchema.parse({
    id: "intercity:arrival",
    role: "arrival",
    mode: "rail",
    serviceNumber: "TEST001",
    origin: { id: "station:origin", name: "用户录入出发站", location: null },
    destination: { id: "station:city", name: "用户录入到达站", location: [120.1, 30.2] },
    departureAt: parseShanghaiLocalDateTime("2026-10-16T23:40"),
    arrivalAt: parseShanghaiLocalDateTime("2026-10-17T07:30"),
    timeZone: "Asia/Shanghai",
    terminalBufferMinutes: 20,
    farePerPersonFen: null,
    source: { kind: "user", recordedAt: "2026-10-14T00:00:00Z" },
  });
}
function returning(): ManualIntercitySegment {
  const first = arrival();
  return manualIntercitySchema.parse({
    ...first,
    id: "intercity:return",
    role: "return",
    origin: first.destination,
    destination: first.origin,
    departureAt: parseShanghaiLocalDateTime("2026-10-18T14:00"),
    arrivalAt: parseShanghaiLocalDateTime("2026-10-18T21:30"),
    terminalBufferMinutes: 30,
  });
}
function connections(): { arrival: IntercityConnection; return: IntercityConnection } {
  return {
    arrival: { fromId: "station:city", toId: "fixture-0", seconds: 3000, source },
    return: { fromId: "fixture-3", toId: "station:city", seconds: 2700, source },
  };
}

describe("Shanghai dated intercity input foundation (not saved/UI integration)", () => {
  it("normalizes local input independently of host TZ and retains overnight arrival dates", () => {
    try {
      for (const zone of ["UTC", "America/New_York"]) {
        vi.stubEnv("TZ", zone);
        expect(parseShanghaiLocalDateTime("2026-10-16T23:40")).toBe(
          "2026-10-16T15:40:00.000Z",
        );
        expect(parseShanghaiLocalDateTime("2026-10-17T07:30")).toBe(
          "2026-10-16T23:30:00.000Z",
        );
      }
    } finally {
      vi.unstubAllEnvs();
    }
    expect(
      (Date.parse(arrival().arrivalAt) - Date.parse(arrival().departureAt)) / 60_000,
    ).toBe(470);
  });
  it.each([
    "2026-02-30T09:00",
    "2026-10-17T24:00",
    "2026-10-17T09:60",
    "09:00",
    "2026-10-17T09:00Z",
    "2026-10-17T09:00:00",
  ])("rejects ambiguous or invalid local input: %s", (value) => {
    expect(() => parseShanghaiLocalDateTime(value)).toThrow();
  });
  it("keeps leap days, month/year rollover and overflow activity minutes as complete instants", () => {
    expect(parseShanghaiLocalDateTime("2028-02-29T00:00")).toBe(
      "2028-02-28T16:00:00.000Z",
    );
    expect(atShanghaiMinute("2026-12-31", 1500)).toBe("2026-12-31T17:00:00.000Z");
    expect(atShanghaiMinute("2026-10-31", 1440)).toBe("2026-10-31T16:00:00.000Z");
    expect(atShanghaiMinute("2026-10-17", null)).toBeNull();
    for (const minute of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => atShanghaiMinute("2026-10-17", minute)).toThrow();
    }
  });
  it("strictly validates manual source, chronology, dated minute precision and bounded money", () => {
    const segment = arrival();
    for (const invalid of [
      { ...segment, source: { kind: "provider", recordedAt: segment.source.recordedAt } },
      { ...segment, departureAt: "23:40" },
      { ...segment, arrivalAt: segment.departureAt },
      { ...segment, origin: segment.destination },
      { ...segment, timeZone: "UTC" },
      { ...segment, arrivalAt: "2026-10-17T07:30:01.000Z" },
      { ...segment, farePerPersonFen: -1 },
      { ...segment, farePerPersonFen: 1.1 },
      { ...segment, terminalBufferMinutes: -1 },
      { ...segment, passengerName: "not part of this contract" },
    ]) {
      expect(manualIntercitySchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      manualIntercitySchema.parse({
        ...segment,
        farePerPersonFen: 0,
        terminalBufferMinutes: 0,
      }),
    ).toMatchObject({ farePerPersonFen: 0, terminalBufferMinutes: 0 });
    expect(manualIntercitySchema.parse(segment).farePerPersonFen).toBeNull();
    expect(intercitySegmentsSchema.safeParse([segment, segment]).success).toBe(false);
    expect(
      intercitySegmentsSchema.safeParse([segment, { ...returning(), id: segment.id }])
        .success,
    ).toBe(false);
  });
  it("adds exit/entry buffers once and consumes complete route duration without double-counting waiting", () => {
    const draft = fixtureDraft();
    const segments = [arrival(), returning()];
    const transfer = connections();
    const before = structuredClone({ draft, segments, transfer });
    const report = evaluateIntercity(draft, segments, transfer);
    expect(report.checks.map((check) => check.slackSeconds)).toEqual([1200, 600]);
    expect(report.checks.map((check) => check.state)).toEqual([
      "compatible",
      "compatible",
    ]);
    expect(report.status).toBe("unverified");
    expect(report.notices.join()).toContain("不代表实时票价、余票或已出票");
    expect({ draft, segments, transfer }).toEqual(before);
  });
  it("keeps missing routes, null buffers, unknown activity times and missing segments unknown", () => {
    const draft = fixtureDraft();
    expect(evaluateIntercity(draft, [], {}).checks.map((check) => check.state)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(evaluateIntercity(draft, [arrival()], {}).checks[0]).toMatchObject({
      state: "unknown",
      slackSeconds: null,
    });
    const transfer = connections();
    transfer.arrival.seconds = null;
    expect(evaluateIntercity(draft, [arrival()], transfer).checks[0].message).toContain(
      "不按零",
    );
    expect(
      evaluateIntercity(
        draft,
        [{ ...arrival(), terminalBufferMinutes: null }],
        connections(),
      ).checks[0].message,
    ).toContain("缓冲未知");
    draft.days[0].items[0].startMinute = null;
    expect(
      evaluateIntercity(draft, [arrival()], connections()).checks[0].message,
    ).toContain("活动时间未知");
  });
  it("unknown routes or buffers cannot hide already provable time conflicts", () => {
    const draft = fixtureDraft();
    for (const [segment, transfer] of [
      [{ ...arrival(), arrivalAt: parseShanghaiLocalDateTime("2026-10-17T10:00") }, {}],
      [
        {
          ...returning(),
          departureAt: parseShanghaiLocalDateTime("2026-10-18T12:00"),
          terminalBufferMinutes: null,
        },
        {},
      ],
      [
        {
          ...arrival(),
          arrivalAt: parseShanghaiLocalDateTime("2026-10-17T08:45"),
          terminalBufferMinutes: 30,
        },
        {},
      ],
      [
        {
          ...arrival(),
          arrivalAt: parseShanghaiLocalDateTime("2026-10-17T08:45"),
          terminalBufferMinutes: null,
        },
        connections(),
      ],
    ] as const) {
      const report = evaluateIntercity(draft, [segment], transfer);
      expect(report.status).toBe("infeasible");
      expect(report.checks.find((check) => check.role === segment.role)).toMatchObject({
        state: "conflict",
        slackSeconds: null,
      });
    }
    const stale = { ...connections().arrival, toId: "old-place", seconds: 999999 };
    expect(
      evaluateIntercity(draft, [arrival()], { arrival: stale }).checks[0].state,
    ).toBe("unknown");
  });
  it("does not reuse a reversed or stale-endpoint connection", () => {
    const transfer = connections();
    [transfer.arrival.fromId, transfer.arrival.toId] = [
      transfer.arrival.toId,
      transfer.arrival.fromId,
    ];
    expect(
      evaluateIntercity(fixtureDraft(), [arrival()], transfer).checks[0],
    ).toMatchObject({ state: "unknown", slackSeconds: null });
    transfer.arrival = { ...connections().arrival, toId: "old-place" };
    expect(
      evaluateIntercity(fixtureDraft(), [arrival()], transfer).checks[0].message,
    ).toContain("端点已变化");
  });
  it("reports late arrival and early return as conflicts without shifting activities", () => {
    const draft = fixtureDraft();
    const segments = [
      { ...arrival(), arrivalAt: parseShanghaiLocalDateTime("2026-10-17T09:00") },
      { ...returning(), departureAt: parseShanghaiLocalDateTime("2026-10-18T13:00") },
    ];
    const report = evaluateIntercity(draft, segments, connections());
    expect(report.status).toBe("infeasible");
    expect(report.checks.map((check) => check.state)).toEqual(["conflict", "conflict"]);
    expect(report.checks[0].slackSeconds).toBe(-4200);
    expect(report.checks[1].slackSeconds).toBe(-3000);
    expect(draft.days[0].items[0].startMinute).toBe(540);
  });
  it("accepts an exact connection boundary and explicit zero estimates, never inferring verified feasibility", () => {
    const segment = {
      ...returning(),
      departureAt: parseShanghaiLocalDateTime("2026-10-18T13:50"),
    };
    expect(
      evaluateIntercity(fixtureDraft(), [segment], connections()).checks[1],
    ).toMatchObject({ state: "compatible", slackSeconds: 0 });
    const zero = {
      ...arrival(),
      arrivalAt: parseShanghaiLocalDateTime("2026-10-17T09:00"),
      terminalBufferMinutes: 0,
    };
    expect(
      evaluateIntercity(fixtureDraft(), [zero], {
        arrival: { ...connections().arrival, seconds: 0 },
      }).checks[0],
    ).toMatchObject({ state: "compatible", slackSeconds: 0 });
  });
  it("detects reversed overall trip chronology even when both local transfers are unknown", () => {
    const late = {
      ...arrival(),
      arrivalAt: parseShanghaiLocalDateTime("2026-10-18T15:00"),
    };
    const report = evaluateIntercity(fixtureDraft(), [late, returning()], {});
    expect(report.status).toBe("infeasible");
    expect(report.notices.join()).toContain("返程出发不晚于到达");
  });
  it("preserves next-day activity overflow instead of matching the return by clock time only", () => {
    const draft = fixtureDraft();
    draft.days[1].items[1].endMinute = 1500;
    const report = evaluateIntercity(draft, [returning()], connections());
    expect(report.checks[1]).toMatchObject({
      state: "conflict",
      activityAt: "2026-10-18T17:00:00.000Z",
    });
  });
  it("refuses duplicate roles and invalid route durations rather than treating them as zero", () => {
    expect(() =>
      evaluateIntercity(fixtureDraft(), [arrival(), arrival()], connections()),
    ).toThrow();
    for (const seconds of [-1, NaN, Infinity]) {
      expect(() =>
        evaluateIntercity(fixtureDraft(), [arrival()], {
          arrival: { ...connections().arrival, seconds },
        }),
      ).toThrow();
    }
  });
});

import type { EditState } from "@/domain/editing";
import { deriveMealTrip } from "@/domain/meals";
import {
  parseShanghaiLocalDateTime,
  toShanghaiLocalDateTime,
  type IntercityRole,
  type IntercitySetup,
  type ManualIntercitySegment,
  type UserStation,
} from "@/domain/intercity";
import { intercitySetupSchema, manualIntercitySchema } from "@/lib/intercity-contracts";
import { parseYuanFen } from "@/lib/money";

export type IntercityFields = {
  enabled: boolean;
  mode: "rail" | "flight";
  number: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  buffer: string;
  fare: string;
  transfer: string;
};
export type IntercityForm = Record<IntercityRole, IntercityFields>;
export const roleLabels = { arrival: "到达", return: "返程" } as const;

function endpoint(state: EditState, role: IntercityRole) {
  const { draft } = deriveMealTrip(state.draft, state.locks, state.meals);
  return role === "arrival"
    ? draft.days[0]?.items[0]?.place
    : draft.days.at(-1)?.items.at(-1)?.place;
}

export function initialIntercityForm(state: EditState): IntercityForm {
  const fields = (role: IntercityRole): IntercityFields => {
    const segment = state.intercity.segments.find((item) => item.role === role);
    const connection = state.intercity.connections[role];
    const stop = endpoint(state, role);
    const matches =
      segment &&
      stop &&
      connection &&
      (role === "arrival"
        ? connection.fromId === segment.destination.id && connection.toId === stop.id
        : connection.fromId === stop.id && connection.toId === segment.origin.id);
    return {
      enabled: Boolean(segment),
      mode: segment?.mode ?? "rail",
      number: segment?.serviceNumber ?? "",
      origin: segment?.origin.name ?? "",
      destination: segment?.destination.name ?? "",
      departure: segment ? toShanghaiLocalDateTime(segment.departureAt) : "",
      arrival: segment ? toShanghaiLocalDateTime(segment.arrivalAt) : "",
      buffer:
        segment?.terminalBufferMinutes == null
          ? ""
          : String(segment.terminalBufferMinutes),
      fare:
        segment?.farePerPersonFen == null
          ? ""
          : (segment.farePerPersonFen / 100).toFixed(2),
      transfer:
        matches && connection.seconds !== null
          ? String(Math.ceil(connection.seconds / 60))
          : "",
    };
  };
  return { arrival: fields("arrival"), return: fields("return") };
}

function minutes(raw: string, max: number): number | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  ) {
    throw new Error(`分钟数须为 0—${max} 的整数，留空表示未知。`);
  }
  return Number(value);
}

export function buildIntercityForm(
  state: EditState,
  form: IntercityForm,
  recordedAt: string,
): IntercitySetup {
  const setup: IntercitySetup = { segments: [], connections: {} };
  for (const role of ["arrival", "return"] as const) {
    const fields = form[role];
    if (!fields.enabled) {
      continue;
    }
    const old = state.intercity.segments.find((item) => item.role === role);
    const station = (name: string, previous?: UserStation): UserStation =>
      previous?.name === name.trim()
        ? { ...previous }
        : { id: `station:${crypto.randomUUID()}`, name: name.trim(), location: null };
    const fare = fields.fare.trim() ? parseYuanFen(fields.fare.trim()) : null;
    if (fields.fare.trim() && fare === null) {
      throw new Error(`${roleLabels[role]}票价估算须为非负金额，最多两位小数。`);
    }
    const segment: ManualIntercitySegment = manualIntercitySchema.parse({
      id: old?.id ?? `intercity:${crypto.randomUUID()}`,
      role,
      mode: fields.mode,
      serviceNumber: fields.number.trim() || null,
      origin: station(fields.origin, old?.origin),
      destination: station(fields.destination, old?.destination),
      departureAt: parseShanghaiLocalDateTime(fields.departure),
      arrivalAt: parseShanghaiLocalDateTime(fields.arrival),
      timeZone: "Asia/Shanghai",
      terminalBufferMinutes: minutes(fields.buffer, 360),
      farePerPersonFen: fare,
      source: { kind: "user", recordedAt },
    });
    if (
      old &&
      (
        [
          "mode",
          "serviceNumber",
          "departureAt",
          "arrivalAt",
          "terminalBufferMinutes",
          "farePerPersonFen",
        ] as const
      ).every((key) => segment[key] === old[key]) &&
      segment.origin.id === old.origin.id &&
      segment.destination.id === old.destination.id
    ) {
      segment.source = old.source;
    }
    setup.segments.push(segment);
    const stop = endpoint(state, role);
    const duration = minutes(fields.transfer, 1440);
    if (!stop || duration === null) {
      setup.connections[role] = null;
      continue;
    }
    const fromId = role === "arrival" ? segment.destination.id : stop.id;
    const toId = role === "arrival" ? stop.id : segment.origin.id;
    const previous = state.intercity.connections[role];
    const seconds = duration * 60;
    setup.connections[role] = {
      fromId,
      toId,
      seconds,
      source:
        previous?.fromId === fromId &&
        previous.toId === toId &&
        previous.seconds === seconds &&
        previous.source.kind === "user"
          ? previous.source
          : {
              kind: "user",
              provider: "user",
              queriedAt: recordedAt,
              coordinateSystem: "GCJ-02",
            },
    };
  }
  return intercitySetupSchema.parse(setup);
}

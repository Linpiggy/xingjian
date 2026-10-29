import type { Coordinate, Day } from "@/domain/models";

export type ReplayPart = {
  legIndex: number;
  path: Coordinate[];
  cumulative: number[];
  distance: number;
  startMs: number;
  endMs: number;
  gapBefore: boolean;
  from: string;
  to: string;
};
export type ReplayTrack = {
  parts: ReplayPart[];
  durationMs: number;
  missingLegs: number[];
};

function valid(point: Coordinate) {
  return (
    point.length === 2 &&
    point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 &&
    Math.abs(point[1]) <= 90
  );
}
function distance(a: Coordinate, b: Coordinate) {
  const radians = Math.PI / 180;
  const latitude = (b[1] - a[1]) * radians;
  const longitude = (b[0] - a[0]) * radians;
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}

// This is a presentation clock, not a prediction of walking time. Each supplied
// segment stays separate; missing geometry never becomes an endpoint shortcut.
export function routeReplay(day: Day): ReplayTrack {
  const parts: ReplayPart[] = [];
  const missingLegs: number[] = [];
  for (let index = 0; index < Math.max(0, day.items.length - 1); index += 1) {
    const before = parts.length;
    for (const path of day.legs[index]?.route?.segments ?? []) {
      if (path.length < 2 || !path.every(valid)) {
        continue;
      }
      const cumulative = [0];
      for (let cursor = 1; cursor < path.length; cursor += 1) {
        cumulative.push(
          cumulative[cursor - 1] + distance(path[cursor - 1], path[cursor]),
        );
      }
      const length = cumulative.at(-1)!;
      if (length <= 0) {
        continue;
      }
      parts.push({
        legIndex: index,
        path,
        cumulative,
        distance: length,
        startMs: 0,
        endMs: 0,
        gapBefore: false,
        from: day.items[index].place.name,
        to: day.items[index + 1].place.name,
      });
    }
    if (parts.length === before) {
      missingLegs.push(index);
    }
  }
  const total = parts.reduce((sum, part) => sum + part.distance, 0);
  let clock = 0;
  for (const [index, part] of parts.entries()) {
    const previous = parts[index - 1];
    const end = previous?.path.at(-1);
    part.gapBefore = Boolean(
      previous &&
      (previous.legIndex + 1 < part.legIndex ||
        end?.[0] !== part.path[0][0] ||
        end?.[1] !== part.path[0][1]),
    );
    if (part.gapBefore) {
      clock += 700;
    }
    part.startMs = clock;
    clock += Math.max(300, (18_000 * part.distance) / total);
    part.endMs = clock;
  }
  return { parts, durationMs: clock, missingLegs };
}

export function replayFrame(track: ReplayTrack, elapsedMs: number) {
  const elapsed = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(track.durationMs, elapsedMs))
    : 0;
  const index = track.parts.findIndex((part) => elapsed <= part.endMs);
  const part = track.parts[index];
  if (!part || elapsed < part.startMs) {
    return { position: null, index, gap: Boolean(part), finished: !part };
  }
  const target = (part.distance * (elapsed - part.startMs)) / (part.endMs - part.startMs);
  let right = 1;
  while (right < part.cumulative.length - 1 && part.cumulative[right] < target) {
    right += 1;
  }
  const left = right - 1;
  const span = part.cumulative[right] - part.cumulative[left];
  const fraction = span > 0 ? (target - part.cumulative[left]) / span : 0;
  const position: Coordinate = [
    part.path[left][0] + (part.path[right][0] - part.path[left][0]) * fraction,
    part.path[left][1] + (part.path[right][1] - part.path[left][1]) * fraction,
  ];
  return { position, index, gap: false, finished: elapsed >= track.durationMs };
}

// Relative positions only, deliberately no invented streets or map tiles.
export function routeProjection(day: Day, viewport = { width: 720, height: 440 }) {
  const frameWidth = Math.max(120, viewport.width);
  const frameHeight = Math.max(120, viewport.height);
  const paths = day.legs
    .slice(0, Math.max(0, day.items.length - 1))
    .flatMap((leg) =>
      (leg.route?.segments ?? []).filter((path) => path.length >= 2 && path.every(valid)),
    );
  const coordinates = [
    ...day.items.map((item) => item.place.location).filter(valid),
    ...paths.flat(),
  ];
  const minLng = Math.min(...coordinates.map((point) => point[0]));
  const maxLng = Math.max(...coordinates.map((point) => point[0]));
  const minLat = Math.min(...coordinates.map((point) => point[1]));
  const maxLat = Math.max(...coordinates.map((point) => point[1]));
  const cosine = coordinates.length
    ? Math.max(0.001, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180))
    : 1;
  const width = coordinates.length ? (maxLng - minLng) * cosine : 0;
  const height = coordinates.length ? maxLat - minLat : 0;
  const scale = Math.min(
    (frameWidth - 100) / (width || 0.00001),
    (frameHeight - 100) / (height || 0.00001),
  );
  function project(point: Coordinate): Coordinate {
    if (!coordinates.length || !valid(point)) {
      return [frameWidth / 2, frameHeight / 2];
    }
    return [
      frameWidth / 2 + (point[0] - (minLng + maxLng) / 2) * cosine * scale,
      frameHeight / 2 - (point[1] - (minLat + maxLat) / 2) * scale,
    ];
  }
  return { paths, project };
}

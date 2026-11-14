/**
 * 行程地图：高德 JS API 2.0 绘制编号站点与真实路线折线。
 * 未配置 JS Key 或加载失败时退回 SVG 示意图：只画真实返回的路线点，不补直线、不伪装成底图。
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, Day, Hotel, Intercity, Place, Station } from "@/lib/schema";

interface MapPoint {
  id: string;
  name: string;
  location: Coordinate;
  label: string;
  tone: "sight" | "meal" | "candidate" | "hotel" | "station";
}

interface MapLine {
  path: Coordinate[];
  mode: "walking" | "transit" | "taxi";
}

/* 最小化的高德 SDK 类型，只声明用到的部分 */
interface AMapMap {
  add(overlays: unknown[]): void;
  remove(overlays: unknown[]): void;
  setFitView(
    overlays?: unknown[] | null,
    immediately?: boolean,
    padding?: number[],
  ): void;
  on(event: string, handler: () => void): void;
  destroy(): void;
}
interface AMapSdk {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => {
    on(event: string, handler: () => void): void;
  };
  Polyline: new (options: Record<string, unknown>) => unknown;
  Scale: new () => unknown;
}

const COLORS: Record<MapPoint["tone"], string> = {
  hotel: "#2d5b78",
  station: "#1d1914",
  sight: "#1f5a47",
  meal: "#b0512a",
  candidate: "#8d8274",
};
const LINE_COLORS = { walking: "#1f5a47", transit: "#2d5b78", taxi: "#9a6512" };

let sdkPromise: Promise<AMapSdk> | null = null;

function loadSdk(key: string): Promise<AMapSdk> {
  if (!sdkPromise) {
    (window as unknown as { _AMapSecurityConfig: unknown })._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    };
    sdkPromise = import("@amap/amap-jsapi-loader")
      .then(({ default: loader }) =>
        loader.load({ key, version: "2.0", plugins: ["AMap.Scale"] }),
      )
      .then((sdk) => sdk as AMapSdk)
      .catch((error) => {
        sdkPromise = null;
        throw error;
      });
  }
  return sdkPromise;
}

function markerHtml(point: MapPoint, active: boolean): string {
  const color = COLORS[point.tone];
  const size = point.tone === "candidate" ? 10 : active ? 34 : 28;
  if (point.tone === "candidate") {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translate(-50%,-50%)"></div>`;
  }
  return `<div style="transform:translate(-50%,-50%);display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;font:600 13px/1 'Noto Sans SC Variable',sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${point.label}</div>`;
}

export function buildMapData(
  days: Day[],
  candidates: Place[],
  hotel: Hotel | null = null,
  stations: Station[] = [],
): { points: MapPoint[]; lines: MapLine[] } {
  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  for (const day of days) {
    day.stops.forEach((stop, index) => {
      points.push({
        id: `${day.day}-${index}`,
        name: stop.place.name,
        location: stop.place.location,
        label: days.length > 1 ? `${day.day}·${index + 1}` : String(index + 1),
        tone: stop.kind === "meal" ? "meal" : "sight",
      });
    });
    for (const leg of [
      ...day.legs,
      ...(day.startLeg ? [day.startLeg] : []),
      ...(day.endLeg ? [day.endLeg] : []),
    ]) {
      if (leg.path.length >= 2) {
        lines.push({ path: leg.path, mode: leg.mode });
      }
    }
  }
  const used = new Set(days.flatMap((day) => day.stops.map((stop) => stop.place.id)));
  for (const place of candidates) {
    if (!used.has(place.id) && !points.some((point) => point.id === `c-${place.id}`)) {
      points.push({
        id: `c-${place.id}`,
        name: place.name,
        location: place.location,
        label: "",
        tone: "candidate",
      });
    }
  }
  if (hotel && days.some((day) => day.startLeg || day.endLeg)) {
    points.push({
      id: "hotel",
      name: hotel.place.name,
      location: hotel.place.location,
      label: "宿",
      tone: "hotel",
    });
  }
  for (const station of stations) {
    points.push({
      id: `station-${station.name}`,
      name: station.name,
      location: station.location,
      label: "站",
      tone: "station",
    });
  }
  return { points, lines };
}

/** 某一天地图上需要显示的车站：第一天的到达站、最后一天的出发站 */
export function stationsForDay(
  day: number,
  totalDays: number,
  intercity: Intercity | null,
): Station[] {
  const result: Station[] = [];
  if (day === 1 && intercity?.outbound && intercity.arrivalStation) {
    result.push(intercity.arrivalStation);
  }
  if (day === totalDays && intercity?.inbound && intercity.departureStation) {
    if (!result.some((item) => item.name === intercity.departureStation?.name)) {
      result.push(intercity.departureStation);
    }
  }
  return result;
}

export function TripMap({
  days,
  candidates = [],
  hotel = null,
  stations = [],
  activeId,
  onSelect,
  className = "",
  framed = true,
}: {
  days: Day[];
  candidates?: Place[];
  hotel?: Hotel | null;
  stations?: Station[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  /** 是否带圆角边框（全屏时关闭） */
  framed?: boolean;
}) {
  const frame = framed ? "rounded-2xl border border-line" : "";
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<{ instance: AMapMap; sdk: AMapSdk } | null>(null);
  const [failed, setFailed] = useState(!key);
  const data = useMemo(
    () => buildMapData(days, candidates, hotel, stations),
    [days, candidates, hotel, stations],
  );
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!key || !container.current) {
      return;
    }
    let disposed = false;
    let instance: AMapMap | null = null;
    const timer = setTimeout(() => setFailed(true), 15_000);
    loadSdk(key)
      .then((sdk) => {
        if (disposed || !container.current) {
          return;
        }
        instance = new sdk.Map(container.current, {
          zoom: 12,
          viewMode: "2D",
          mapStyle: "amap://styles/whitesmoke",
        });
        instance.add([new sdk.Scale()]);
        instance.on("complete", () => {
          clearTimeout(timer);
          if (!disposed && instance) {
            setMap({ instance, sdk });
          }
        });
      })
      .catch(() => {
        clearTimeout(timer);
        if (!disposed) {
          setFailed(true);
        }
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      setMap(null);
      try {
        instance?.destroy();
      } catch {
        // ignore
      }
    };
  }, [key]);

  useEffect(() => {
    if (!map) {
      return;
    }
    const { instance, sdk } = map;
    const overlays: unknown[] = [];
    for (const line of data.lines) {
      overlays.push(
        new sdk.Polyline({
          path: line.path,
          strokeColor: "#ffffff",
          strokeWeight: 8,
          strokeOpacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
          zIndex: 10,
        }),
        new sdk.Polyline({
          path: line.path,
          strokeColor: LINE_COLORS[line.mode],
          strokeWeight: 4.5,
          strokeOpacity: 0.95,
          strokeStyle: line.mode === "walking" ? "dashed" : "solid",
          strokeDasharray: [8, 6],
          lineJoin: "round",
          lineCap: "round",
          showDir: line.mode !== "walking",
          zIndex: 11,
        }),
      );
    }
    for (const point of data.points) {
      const marker = new sdk.Marker({
        position: point.location,
        content: markerHtml(point, point.id === activeId),
        title: point.name,
        zIndex: point.tone === "candidate" ? 20 : point.id === activeId ? 40 : 30,
        anchor: "center",
      });
      if (
        point.tone !== "candidate" &&
        point.tone !== "hotel" &&
        point.tone !== "station"
      ) {
        marker.on("click", () => select.current?.(point.id));
      }
      overlays.push(marker);
    }
    instance.add(overlays);
    instance.setFitView(null, false, [48, 48, 48, 48]);
    return () => {
      // 卸载时地图实例可能已先被销毁，此时无需也无法再移除覆盖物
      try {
        instance.remove(overlays);
      } catch {
        // ignore
      }
    };
  }, [map, data, activeId]);

  if (failed) {
    return (
      <SchematicMap
        data={data}
        activeId={activeId}
        onSelect={onSelect}
        className={className}
        framed={framed}
      />
    );
  }
  return (
    <div className={`relative overflow-hidden ${frame} bg-paper-deep ${className}`}>
      {/* 高德 SDK 会把容器改为 position:relative，因此用文档流内的全尺寸而不是 absolute 铺满 */}
      <div
        ref={container}
        className="h-full w-full"
        role="application"
        aria-label="行程地图"
      />
      {!map ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-ink-faint">
          地图加载中…
        </div>
      ) : null}
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-md bg-card/95 px-2.5 py-1.5 text-[11px] text-ink-soft shadow-lift">
      <span className="flex items-center gap-1">
        <i className="size-2.5 rounded-full bg-pine" />
        景点
      </span>
      <span className="flex items-center gap-1">
        <i className="size-2.5 rounded-full bg-clay" />
        餐饮
      </span>
      <span className="flex items-center gap-1">
        <i className="h-0.5 w-3 bg-sky" />
        公交
      </span>
      <span className="flex items-center gap-1">
        <i className="h-0.5 w-3 bg-amber" />
        打车
      </span>
    </div>
  );
}

/** 无底图时的示意图：等比投影站点与真实路线点串 */
function SchematicMap({
  data,
  activeId,
  onSelect,
  className,
  framed,
}: {
  data: { points: MapPoint[]; lines: MapLine[] };
  activeId?: string | null;
  onSelect?: (id: string) => void;
  className: string;
  framed: boolean;
}) {
  const all = [
    ...data.points.map((point) => point.location),
    ...data.lines.flatMap((line) => line.path),
  ];
  if (!all.length) {
    return (
      <div
        className={`grid place-items-center ${framed ? "rounded-2xl border border-dashed border-line" : ""} bg-paper-deep/50 text-sm text-ink-faint ${className}`}
      >
        地点确定后会显示在这里
      </div>
    );
  }
  const lngs = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...lngs),
    Math.max(...lngs),
    Math.min(...lats),
    Math.max(...lats),
  ];
  const span = Math.max(maxX - minX, (maxY - minY) * 1.15, 0.005);
  const project = ([lng, lat]: Coordinate) => [
    20 + ((lng - minX) / span) * 360 + (360 - ((maxX - minX) / span) * 360) / 2,
    20 +
      ((maxY - lat) / span) * 1.15 * 260 +
      (260 - (((maxY - minY) * 1.15) / span) * 260) / 2,
  ];
  return (
    <div
      className={`relative overflow-hidden ${framed ? "rounded-2xl border border-line" : ""} bg-paper-deep/60 paper-grain ${className}`}
    >
      <svg
        viewBox="0 0 400 300"
        className="size-full"
        role="img"
        aria-label="行程路线示意图"
      >
        {data.lines.map((line, index) => (
          <polyline
            key={index}
            points={line.path.map((p) => project(p).join(",")).join(" ")}
            fill="none"
            stroke={LINE_COLORS[line.mode]}
            strokeWidth={2}
            strokeDasharray={line.mode === "walking" ? "4 3" : undefined}
            strokeLinejoin="round"
            opacity={0.85}
          />
        ))}
        {data.points.map((point) => {
          const [x, y] = project(point.location);
          if (point.tone === "candidate") {
            return (
              <circle
                key={point.id}
                cx={x}
                cy={y}
                r={3}
                fill={COLORS.candidate}
                opacity={0.6}
              />
            );
          }
          const active = point.id === activeId;
          return (
            <g
              key={point.id}
              onClick={() => onSelect?.(point.id)}
              className="cursor-pointer"
              role="button"
              aria-label={point.name}
            >
              <circle
                cx={x}
                cy={y}
                r={active ? 12 : 10}
                fill={COLORS[point.tone]}
                stroke="#fff"
                strokeWidth={2}
              />
              <text
                x={x}
                y={y + 3.5}
                textAnchor="middle"
                fontSize={point.label.length > 2 ? 7 : 9}
                fontWeight={600}
                fill="#fff"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="absolute right-3 top-3 rounded bg-card/90 px-2 py-0.5 text-[11px] text-ink-faint">
        路线示意 · 未加载底图
      </span>
    </div>
  );
}

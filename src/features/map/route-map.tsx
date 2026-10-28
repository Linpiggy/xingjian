"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, RotateCw, Scan } from "lucide-react";
import type { Day } from "@/domain/models";
import { stopIdentity } from "@/domain/meals";
import { initializeMap, type MapFailure } from "./initialize-map";
import { routeMapPaths, routeLineStyle } from "./route-presentation";

const failureMessages: Record<MapFailure, string> = {
  sdk_failed: "地图加载失败，请检查网络后重试。",
  sdk_timeout: "地图加载超时，请检查网络后重试。",
  basemap_timeout: "底图加载超时，请稍后重试。",
  initialization_failed: "地图初始化失败，行程草稿仍保留。",
};

type Runtime = { map: AMap.Map; sdk: typeof AMap };
export function RouteMap({
  day,
  selectedId,
  onSelect,
  mapKey,
  configured,
}: {
  day: Day;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mapKey: string;
  configured: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef<{ id: string; element: HTMLButtonElement }[]>([]);
  const lines = useRef<{ overlay: AMap.Polyline; activityIds: string[] }[]>([]);
  const initialCenter = useRef(day.items[0]?.place.location);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [failed, setFailed] = useState<MapFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!configured || !container.current) {
      return;
    }
    const root = container.current;
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    };
    return initializeMap({
      load: async () => {
        const loaderModule = await import("@amap/amap-jsapi-loader");
        if (attempt) {
          loaderModule.default.reset();
        }
        return loaderModule.default.load({ key: mapKey, version: "2.0" });
      },
      create: (sdk) =>
        new sdk.Map(root, {
          zoom: 12,
          viewMode: "2D",
          jogEnable: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          center: initialCenter.current,
        }),
      onReady: (map, sdk) => setRuntime({ map, sdk }),
      onFailure: setFailed,
    });
  }, [configured, mapKey, attempt]);
  useEffect(() => {
    if (!runtime) {
      return;
    }
    const { map, sdk } = runtime;
    map.clearMap();
    buttons.current = [];
    lines.current = [];
    for (const [index, item] of day.items.entries()) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "map-marker route-marker";
      element.dataset.purpose = item.purpose ?? "visit";
      element.textContent = String(index + 1);
      element.title = item.place.name;
      element.setAttribute("aria-label", `选中地点：${item.place.name}`);
      element.addEventListener("click", () => onSelect(stopIdentity(item)));
      buttons.current.push({ id: stopIdentity(item), element });
      map.add(
        new sdk.Marker({
          position: item.place.location,
          content: element,
          anchor: "center",
        }),
      );
    }
    for (const segment of routeMapPaths(day)) {
      const overlay = new sdk.Polyline({
        path: segment.path,
        ...routeLineStyle("normal"),
      });
      lines.current.push({ overlay, activityIds: segment.activityIds });
      map.add(overlay);
    }
    if (day.items.length) {
      map.setFitView(undefined, true, [48, 48, 48, 48]);
    }
    return () => {
      buttons.current = [];
      lines.current = [];
    };
  }, [runtime, day, onSelect]);
  useEffect(() => {
    for (const button of buttons.current) {
      button.element.classList.toggle("selected", button.id === selectedId);
      button.element.setAttribute("aria-pressed", String(button.id === selectedId));
    }
    for (const line of lines.current) {
      line.overlay.setOptions(
        routeLineStyle(
          !selectedId
            ? "normal"
            : line.activityIds.includes(selectedId)
              ? "selected"
              : "muted",
        ),
      );
    }
    const item = day.items.find((item) => stopIdentity(item) === selectedId);
    if (runtime && item) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      runtime.map.setCenter(item.place.location, reduce, reduce ? 0 : 260);
    }
  }, [runtime, selectedId, day]);
  const mappedLegs = day.legs.filter((leg) =>
    leg.route?.segments.some((path) => path.length >= 2),
  ).length;
  return (
    <div className="route-map">
      <div className="map-stage" role="region" aria-label="当天真实地图">
        <div ref={container} className="map-canvas" />
        {runtime && !failed && (
          <button
            type="button"
            className="route-map-fit"
            aria-label="查看全日路线"
            onClick={() =>
              runtime.map.setFitView(
                undefined,
                window.matchMedia("(prefers-reduced-motion: reduce)").matches,
                [48, 48, 48, 48],
              )
            }
          >
            <Scan size={16} aria-hidden="true" />
            全日视野
          </button>
        )}
        {!configured ? (
          <div className="map-state">
            <MapPin size={36} aria-hidden="true" />
            <h3>地图暂不可用</h3>
            <p>你的行程已保留，仍可在行程中查看步行耗时与距离。</p>
          </div>
        ) : failed ? (
          <div className="map-state">
            <h3>地图加载失败</h3>
            <p>{failureMessages[failed]}</p>
            <p>行程已保留，你可以继续查看地点详情。</p>
            <button
              className="button"
              onClick={() => {
                setFailed(null);
                setRuntime(null);
                setAttempt((value) => value + 1);
              }}
            >
              <RotateCw size={18} />
              重试地图
            </button>
          </div>
        ) : !runtime ? (
          <div className="map-state skeleton-lines" role="status">
            <span />
            <span />
            <p>正在加载高德地图。</p>
          </div>
        ) : null}
      </div>
      <footer className="route-map-legend" aria-label="地图图例与轨迹覆盖">
        <span>
          <i className="route-legend-visit" aria-hidden="true" />
          游览
        </span>
        <span>
          <i className="route-legend-meal" aria-hidden="true" />
          三餐
        </span>
        <span>
          {mappedLegs}/{day.legs.length} 段含轨迹
        </span>
        <p>编号对应当天次序；选中地点强调相邻路段。缺失轨迹不以直线补连。</p>
      </footer>
    </div>
  );
}

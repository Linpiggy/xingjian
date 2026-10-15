"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, RotateCw } from "lucide-react";
import type { Day } from "@/domain/models";
import { stopIdentity } from "@/domain/meals";
import { initializeMap, type MapFailure } from "./initialize-map";

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
    for (const [index, item] of day.items.entries()) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "map-marker";
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
    for (const leg of day.legs) {
      for (const path of leg.route?.segments ?? []) {
        map.add(
          new sdk.Polyline({
            path,
            strokeColor: "#16735F",
            strokeWeight: 5,
            strokeOpacity: 0.9,
          }),
        );
      }
    }
    if (day.items.length) {
      map.setFitView(undefined, false, [60, 60, 60, 60]);
    }
    return () => {
      buttons.current = [];
    };
  }, [runtime, day, onSelect]);
  useEffect(() => {
    for (const button of buttons.current) {
      button.element.classList.toggle("selected", button.id === selectedId);
      button.element.setAttribute("aria-pressed", String(button.id === selectedId));
    }
  }, [runtime, selectedId, day]);
  return (
    <div className="map-stage" role="region" aria-label="当天真实地图">
      <div ref={container} className="map-canvas" />
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
  );
}

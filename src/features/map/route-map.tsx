"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, RotateCw } from "lucide-react";
import type { Day } from "@/domain/models";

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
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!configured || !container.current) {
      return;
    }
    let cancelled = false;
    let map: AMap.Map | undefined;
    const root = container.current;
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    };
    void import("@amap/amap-jsapi-loader")
      .then(async (module) => {
        if (attempt) {
          module.default.reset();
        }
        const sdk = await module.default.load({ key: mapKey, version: "2.0" });
        if (cancelled) {
          return;
        }
        map = new sdk.Map(root, { zoom: 12, viewMode: "2D" });
        setRuntime({ map, sdk });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      map?.destroy();
    };
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
      element.addEventListener("click", () => onSelect(item.place.id));
      buttons.current.push({ id: item.place.id, element });
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
      map.clearMap();
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
          <h3>真实地图未配置</h3>
          <p>需要独立的高德 JS API Key 和服务端安全密钥。</p>
          <p>不会用示意图代替真实底图。已返回的真实路段可在左侧查看耗时与距离。</p>
          <small>在 .env.local 配置后重启应用。</small>
        </div>
      ) : failed ? (
        <div className="map-state">
          <h3>地图加载失败</h3>
          <p>请检查网络、JS Key、域名限制与安全代理。行程草稿仍保留。</p>
          <button
            className="button"
            onClick={() => {
              setFailed(false);
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

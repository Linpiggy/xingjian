"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MapPin, RotateCw, Scan, Maximize2, Plus, Minus, Play } from "lucide-react";
import type { Day } from "@/domain/models";
import { stopIdentity } from "@/domain/meals";
import { initializeMap, type MapFailure } from "./initialize-map";
import { routeMapPaths, routeLineStyle } from "./route-presentation";
import { routeReplay } from "./route-replay";
import { useRouteReplay } from "./use-route-replay";
import { RouteReplayControls } from "./route-replay-controls";
import { RouteDiagram } from "./route-diagram";
import { RouteMapDialog } from "./route-map-dialog";
import { Button } from "@/components/arc/button/button";
import "./route-map.css";

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
  compact = false,
}: {
  day: Day;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mapKey: string;
  configured: boolean;
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const enlarged = useRef<HTMLDivElement>(null);
  // The SDK owns this element. Moving it between React-owned hosts preserves
  // one map instance, its attribution and camera rather than reloading the SDK.
  const canvas = useRef<HTMLDivElement | null>(null);
  const buttons = useRef<{ id: string; element: HTMLButtonElement }[]>([]);
  const lines = useRef<{ overlay: AMap.Polyline; activityIds: string[] }[]>([]);
  const cursorMarker = useRef<AMap.Marker | null>(null);
  const initialCenter = useRef(day.items[0]?.place.location);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [failed, setFailed] = useState<MapFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const track = useMemo(() => routeReplay(day), [day]);
  const replay = useRouteReplay(track);
  const { pause } = replay;
  const select = useCallback(
    (id: string) => {
      pause();
      onSelect(id);
    },
    [onSelect, pause],
  );
  const close = useCallback(() => {
    pause();
    setExpanded(false);
  }, [pause]);
  useEffect(() => {
    if (!configured || !container.current) {
      return;
    }
    const root = document.createElement("div");
    root.className = "map-canvas";
    (enlarged.current ?? container.current).append(root);
    canvas.current = root;
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    };
    const stop = initializeMap({
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
    return () => {
      stop();
      root.remove();
      if (canvas.current === root) {
        canvas.current = null;
      }
    };
  }, [configured, mapKey, attempt]);
  useLayoutEffect(() => {
    const target = expanded ? enlarged.current : container.current;
    if (target && canvas.current) {
      target.append(canvas.current);
      // Fit after the new host has layout using the SDK's public API;
      // do not rely on an undocumented resize method.
      const frame = requestAnimationFrame(() =>
        runtime?.map.setFitView(undefined, true, [48, 48, 48, 48]),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [expanded, runtime]);
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
      element.tabIndex = -1;
      element.className = "map-marker route-marker";
      element.dataset.purpose = item.purpose ?? "visit";
      element.textContent = String(index + 1);
      element.title = item.place.name;
      element.setAttribute("aria-label", `选中地点：${item.place.name}`);
      element.addEventListener("click", () => select(stopIdentity(item)));
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
    const marker = new sdk.Marker({
      position: day.items[0]?.place.location,
      content: '<span class="route-sdk-cursor" aria-hidden="true"></span>',
      anchor: "center",
      zIndex: 200,
    });
    cursorMarker.current = marker;
    map.add(marker);
    marker.hide();
    if (day.items.length) {
      map.setFitView(undefined, true, [48, 48, 48, 48]);
    }
    return () => {
      cursorMarker.current = null;
      buttons.current = [];
      lines.current = [];
    };
  }, [runtime, day, select]);
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
  useEffect(() => {
    const marker = cursorMarker.current;
    if (marker && replay.cursor) {
      marker.setPosition(replay.cursor);
      marker.show();
    } else {
      marker?.hide();
    }
  }, [runtime, replay.cursor]);
  useEffect(() => pause(), [selectedId, pause]);
  const mappedLegs = day.legs.filter((leg) =>
    leg.route?.segments.some((path) => path.length >= 2),
  ).length;
  function stage(host: RefObject<HTMLDivElement | null>, large: boolean) {
    return (
      <div
        className="map-stage route-map-stage"
        role="region"
        aria-label={large ? "放大的当天地图" : "当天真实地图"}
        aria-hidden={!large && expanded ? true : undefined}
        inert={!large && expanded ? true : undefined}
      >
        {(!runtime || failed) && (
          <RouteDiagram
            day={day}
            selectedId={selectedId}
            onSelect={select}
            cursor={replay.cursor}
          />
        )}
        <div
          ref={host}
          className="route-map-host"
          style={{ visibility: runtime && !failed ? "visible" : "hidden" }}
        />
        {runtime && !failed && (
          <div className="route-map-camera">
            <button
              type="button"
              className="button"
              aria-label="查看全日路线"
              onClick={() =>
                runtime.map.setFitView(undefined, replay.reduced, [48, 48, 48, 48])
              }
            >
              <Scan size={16} aria-hidden="true" />
              全日视野
            </button>
            <button
              type="button"
              className="button"
              aria-label="放大一级"
              onClick={() => runtime.map.zoomIn()}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="button"
              aria-label="缩小一级"
              onClick={() => runtime.map.zoomOut()}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }
  const fixture =
    day.items.some((item) => item.place.source.kind === "fixture") ||
    day.legs.some((leg) => leg.route?.source.kind === "fixture");
  const stopIndex = (
    <nav className="route-map-stop-index" aria-label="地图地点索引">
      <ol>
        {day.items.map((item, index) => (
          <li key={stopIdentity(item)}>
            <button
              type="button"
              data-purpose={item.purpose ?? "visit"}
              aria-label={`在路线中查看第 ${index + 1} 站：${item.place.name}`}
              aria-pressed={selectedId === stopIdentity(item)}
              onClick={() => select(stopIdentity(item))}
            >
              <strong>{index + 1}</strong>
              <span>{item.place.name}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
  const status = !configured ? (
    <div className="route-map-status">
      <MapPin size={18} aria-hidden="true" />
      <div>
        <h3>地图暂不可用</h3>
        <p>先查看地点与已有轨迹的几何预览；无底图，不用于导航。</p>
      </div>
    </div>
  ) : failed ? (
    <div className="route-map-status">
      <div>
        <h3>地图加载失败</h3>
        <p>{failureMessages[failed]}行程与几何预览仍保留。</p>
      </div>
      <button
        type="button"
        className="button"
        onClick={() => {
          setFailed(null);
          setRuntime(null);
          setAttempt((value) => value + 1);
        }}
      >
        <RotateCw size={16} aria-hidden="true" />
        重试地图
      </button>
    </div>
  ) : !runtime ? (
    <p className="route-map-status" role="status">
      正在加载高德地图，可先查看路线几何预览。
    </p>
  ) : null;
  return (
    <div className={`route-map${expanded ? " is-expanded" : ""}`}>
      <div className="route-map-toolbar">
        <span>
          {compact
            ? `${day.items.length} 站`
            : `${day.items.length} 站 · ${mappedLegs}/${day.legs.length} 段含轨迹`}
        </span>
        <div className="route-map-toolbar-actions">
          <Button
            className="button"
            aria-haspopup="dialog"
            disabled={!track.parts.length}
            onClick={() => {
              setExpanded(true);
              if (!replay.playing) {
                replay.toggle();
              }
            }}
          >
            <Play size={16} aria-hidden="true" />
            {replay.reduced ? "逐段看路线" : "演示路线"}
          </Button>
          <Button
            className="button"
            aria-haspopup="dialog"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={16} aria-hidden="true" />
            放大地图
          </Button>
        </div>
      </div>
      {stage(container, false)}
      {!expanded && (
        <>
          {stopIndex}
          {status}
          {compact ? (
            <details className="route-inline-inspection">
              <summary>路线演示与检查</summary>
              <RouteReplayControls track={track} replay={replay} />
            </details>
          ) : (
            <RouteReplayControls track={track} replay={replay} />
          )}
        </>
      )}
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
      {expanded && (
        <RouteMapDialog date={day.date} fixture={fixture} onClose={close}>
          {stage(enlarged, true)}
          {stopIndex}
          {status}
          <RouteReplayControls track={track} replay={replay} />
        </RouteMapDialog>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Coordinate, PlaceCandidate } from "@/domain/models";
import { coordinateSchema } from "@/lib/contracts";
import { initializeMap, type MapFailure } from "./initialize-map";

export function PointPicker({
  center,
  mapKey,
  configured,
  onAdd,
  onClose,
}: {
  center: Coordinate;
  mapKey: string;
  configured: boolean;
  onAdd: (candidate: PlaceCandidate) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<{ map: AMap.Map; sdk: typeof AMap } | null>(
    null,
  );
  const [failure, setFailure] = useState<MapFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [point, setPoint] = useState<Coordinate | null>(null);
  const [name, setName] = useState("");
  const initialCenter = useRef(center);
  const detachClick = useRef<(() => void) | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    if (!configured || !canvas.current) {
      return;
    }
    const root = canvas.current;
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}/_AMapService`,
    };
    const stop = initializeMap({
      load: async () => {
        const loader = await import("@amap/amap-jsapi-loader");
        if (attempt) {
          loader.default.reset();
        }
        return loader.default.load({ key: mapKey, version: "2.0" });
      },
      create: (sdk) =>
        new sdk.Map(root, { center: initialCenter.current, zoom: 14, viewMode: "2D" }),
      onReady: (map, sdk) => {
        const pick = (event: { lnglat: AMap.LngLat }) => {
          const result = coordinateSchema.safeParse([
            event.lnglat.getLng(),
            event.lnglat.getLat(),
          ]);
          if (!result.success) {
            return;
          }
          setPoint(result.data);
          map.clearMap();
          map.add(new sdk.Marker({ position: result.data }));
        };
        map.on("click", pick);
        detachClick.current = () => map.off("click", pick);
        setRuntime({ map, sdk });
      },
      onFailure: setFailure,
    });
    return () => {
      detachClick.current?.();
      detachClick.current = null;
      stop();
    };
  }, [configured, mapKey, attempt]);

  function close() {
    dialog.current?.close();
    onClose();
  }

  function confirm() {
    if (!point || !name.trim()) {
      return;
    }
    const id = `user:${crypto.randomUUID()}`;
    onAdd({
      selection: { kind: "user", id, name: name.trim(), location: point },
      place: {
        id,
        name: name.trim(),
        location: point,
        address: null,
        citycode: null,
        openingHours: null,
        source: {
          kind: "user",
          provider: "user",
          queriedAt: new Date().toISOString(),
          coordinateSystem: "GCJ-02",
        },
      },
    });
    close();
  }

  return (
    <dialog
      ref={dialog}
      className="point-dialog"
      aria-labelledby="point-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="point-title">地图添加地点</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭地图选点"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        点击地图选择位置，再填写名称。自定义地点的位置与入口请自行确认。
      </p>
      <div className="map-stage" role="region" aria-label="自定义点选地图">
        <div className="map-canvas" ref={canvas} />
        {!configured ? (
          <div className="map-state">
            <h3>地图暂不可用，无法选点</h3>
            <p>请通过搜索添加地点，已选清单不受影响。</p>
          </div>
        ) : failure ? (
          <div className="map-state">
            <h3>选点地图加载失败</h3>
            <p>
              {failure === "basemap_timeout"
                ? "底图加载超时，请稍后重试。"
                : "请检查网络后重试，也可关闭地图并搜索添加地点。"}
            </p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setFailure(null);
                setRuntime(null);
                setAttempt((value) => value + 1);
              }}
            >
              重试地图
            </button>
          </div>
        ) : !runtime ? (
          <div className="map-state" role="status">
            <p>正在加载真实地图。</p>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="custom-point-name">自定义地点名称</label>
        <input
          id="custom-point-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
        />
        <small role="status">
          {point
            ? `已选 GCJ-02 位置：${point[0].toFixed(6)}, ${point[1].toFixed(6)}`
            : "尚未选择位置"}
        </small>
      </div>
      <div className="form-actions">
        <small>仅代表用户选点，城市、入口、开放与价格未核实。</small>
        <button
          type="button"
          className="button primary"
          disabled={!point || !name.trim()}
          onClick={confirm}
        >
          添加到清单
        </button>
      </div>
    </dialog>
  );
}

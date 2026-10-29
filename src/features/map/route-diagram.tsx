import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, Day } from "@/domain/models";
import { stopIdentity } from "@/domain/meals";
import { routeProjection } from "./route-replay";
import { routeMapPaths } from "./route-presentation";

export function RouteDiagram({
  day,
  selectedId,
  onSelect,
  cursor,
}: {
  day: Day;
  selectedId: string | null;
  onSelect: (id: string) => void;
  cursor: Coordinate | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 720, height: 440 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        setSize((previous) =>
          previous.width === box.width && previous.height === box.height
            ? previous
            : { width: box.width, height: box.height },
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { paths, project } = useMemo(() => routeProjection(day, size), [day, size]);
  const segments = useMemo(() => routeMapPaths(day), [day]);
  const position = cursor ? project(cursor) : null;
  return (
    <div
      ref={ref}
      className="route-diagram"
      role="group"
      aria-label="当天路线几何预览，无地图底图"
    >
      <svg viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        {segments
          .filter((segment) => paths.includes(segment.path))
          .map((segment, index) => (
            <polyline
              key={index}
              points={segment.path.map((point) => project(point).join(",")).join(" ")}
              fill="none"
              stroke="#33734f"
              strokeWidth={selectedId && segment.activityIds.includes(selectedId) ? 6 : 4}
              strokeOpacity={
                !selectedId || segment.activityIds.includes(selectedId) ? 1 : 0.25
              }
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
      </svg>
      {day.items.map((item, index) => {
        const [x, y] = project(item.place.location);
        return (
          <button
            key={stopIdentity(item)}
            type="button"
            className={`map-marker route-marker${selectedId === stopIdentity(item) ? " selected" : ""}`}
            data-purpose={item.purpose ?? "visit"}
            aria-label={`选中地点：${item.place.name}`}
            aria-pressed={selectedId === stopIdentity(item)}
            title={`${index + 1} · ${item.place.name}`}
            style={{
              left: `${(x / size.width) * 100}%`,
              top: `${(y / size.height) * 100}%`,
            }}
            onClick={() => onSelect(stopIdentity(item))}
          >
            {index + 1}
          </button>
        );
      })}
      {position && (
        <svg
          className="route-cursor-overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
        >
          <circle
            className="route-replay-cursor"
            cx={position[0]}
            cy={position[1]}
            r="9"
          />
        </svg>
      )}
      <span className="route-diagram-label">轨迹几何预览 · 无底图，非导航</span>
    </div>
  );
}

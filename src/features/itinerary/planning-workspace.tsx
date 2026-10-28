"use client";

import { useRef, useState } from "react";
import { Sparkles, MapPin } from "lucide-react";
import { FullPlanner } from "./full-planner";
import { Planner } from "@/features/planner/planner";
import { TripSiteHeader } from "./trip-site-header";
import { useItineraryStore } from "./itinerary-store";
import "./itinerary.css";
import "./planning-workspace.css";

export function PlanningWorkspace({
  startDate,
  mapKey,
  mapsConfigured,
  initialMode = "ai",
}: {
  startDate: string;
  mapKey: string;
  mapsConfigured: boolean;
  initialMode?: "ai" | "manual";
}) {
  const revision = useItineraryStore((state) => state.version);
  const [mode, setMode] = useState(initialMode);
  const [manualReady, setManualReady] = useState(initialMode === "manual");
  const [message, setMessage] = useState("");
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const dirty = useRef([false, false]);
  const index = mode === "ai" ? 0 : 1;
  function select(next: "ai" | "manual") {
    if (next === mode) {
      return true;
    }
    if (panels.current[index]?.querySelector('[aria-busy="true"]')) {
      setMessage("请先取消或等待当前生成完成，再切换规划方式；不会自动发起另一份请求。");
      return false;
    }
    setMessage("");
    if (next === "manual") {
      setManualReady(true);
    }
    setMode(next);
    return true;
  }
  function protectNavigation() {
    const panel = panels.current[index];
    const hasForm = panel?.querySelector(
      ".trip-brief-form, .form-layout > .panel > form",
    );
    if (dirty.current[index] && hasForm) {
      return window.confirm(
        "离开会丢弃本页尚未提交的需求，当前已生成方案不会删除。继续吗？",
      );
    }
    return true;
  }
  return (
    <div className="trip-app unified-planner" data-plan-revision={revision}>
      <TripSiteHeader beforeNavigate={protectNavigation} />
      <main id="main">
        <div className="unified-mode-bar">
          <div className="unified-mode-tabs" role="tablist" aria-label="规划方式">
            {(["ai", "manual"] as const).map((value, tabIndex) => (
              <button
                key={value}
                id={`planning-tab-${value}`}
                type="button"
                role="tab"
                aria-selected={mode === value}
                aria-controls={`planning-panel-${value}`}
                tabIndex={mode === value ? 0 : -1}
                onClick={() => select(value)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    return;
                  }
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "ai"
                      : event.key === "End"
                        ? "manual"
                        : tabIndex === 0
                          ? "manual"
                          : "ai";
                  if (select(next)) {
                    document.getElementById(`planning-tab-${next}`)?.focus();
                  }
                }}
              >
                {value === "ai" ? (
                  <Sparkles size={18} aria-hidden="true" />
                ) : (
                  <MapPin size={18} aria-hidden="true" />
                )}
                <span>{value === "ai" ? "完整 AI 规划" : "手动选点"}</span>
                <small>{value === "ai" ? "1—14 天 · 1—20 人" : "2—3 天 · 1—8 人"}</small>
              </button>
            ))}
          </div>
          <p>
            两种方式，同一个工作台。输入和方案分别保留，切换不会自动查询或把自定义点位交给
            AI。
          </p>
          {message && (
            <p className="unified-mode-message" role="status">
              {message}
            </p>
          )}
        </div>
        {(["ai", "manual"] as const).map((value, panelIndex) => (
          <div
            key={value}
            ref={(element) => {
              panels.current[panelIndex] = element;
            }}
            id={`planning-panel-${value}`}
            role="tabpanel"
            aria-labelledby={`planning-tab-${value}`}
            hidden={mode !== value}
            className={`unified-panel unified-${value}`}
            onInputCapture={() => {
              dirty.current[panelIndex] = true;
            }}
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest("button")) {
                dirty.current[panelIndex] = true;
              }
            }}
          >
            {value === "ai" ? (
              <FullPlanner
                embedded
                active={mode === "ai"}
                view="new"
                startDate={startDate}
                mapKey={mapKey}
                mapsConfigured={mapsConfigured}
              />
            ) : manualReady ? (
              <Planner
                embedded
                active={mode === "manual"}
                startDate={startDate}
                mapKey={mapKey}
                mapsConfigured={mapsConfigured}
              />
            ) : null}
          </div>
        ))}
      </main>
    </div>
  );
}

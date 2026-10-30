"use client";

import { useRef, useState } from "react";
import { Sparkles, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  SegmentedContent,
} from "@/components/arc/segmented/segmented";
import { useConfirmDialog } from "@/components/arc/dialog/confirm-dialog";
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
  const [selection, setSelection] = useState({ mode: initialMode, from: initialMode });
  const mode = selection.from === initialMode ? selection.mode : initialMode;
  const [manualReady, setManualReady] = useState(initialMode === "manual");
  const [message, setMessage] = useState("");
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const dirty = useRef([false, false]);
  const index = mode === "ai" ? 0 : 1;
  const { confirm, confirmation } = useConfirmDialog();
  const router = useRouter();
  if (selection.from !== initialMode) {
    setSelection({ mode: initialMode, from: initialMode });
    if (initialMode === "manual") {
      setManualReady(true);
    }
  }
  function select(next: string) {
    if ((next !== "ai" && next !== "manual") || next === mode) {
      return;
    }
    if (panels.current[index]?.querySelector('[aria-busy="true"]')) {
      setMessage("请先取消或等待当前生成完成，再切换规划方式；不会自动发起另一份请求。");
      return;
    }
    setMessage("");
    if (next === "manual") {
      setManualReady(true);
    }
    setSelection({ mode: next, from: initialMode });
    router.replace(next === "manual" ? "/plan?mode=manual" : "/plan", { scroll: false });
  }
  function protectNavigation(href: string) {
    if (panels.current[index]?.querySelector('[aria-busy="true"]')) {
      setMessage("请先取消或等待当前生成完成，再离开规划工作台。");
      return false;
    }
    if (href === "/plan") {
      return true;
    }
    const hasForm = panels.current[index]?.querySelector(
      ".trip-brief-form, .form-layout > .panel > form",
    );
    return dirty.current[index] && hasForm
      ? confirm("离开会丢弃本页尚未提交的需求，当前已生成方案不会删除。继续吗？")
      : true;
  }
  return (
    <div className="trip-app unified-planner" data-plan-revision={revision}>
      {confirmation}
      <TripSiteHeader beforeNavigate={protectNavigation} />
      <main id="main" tabIndex={-1}>
        <Segmented value={mode} onValueChange={select}>
          <div className="unified-mode-bar">
            <SegmentedList aria-label="规划方式">
              <SegmentedTrigger
                value="ai"
                id="planning-tab-ai"
                aria-controls="planning-panel-ai"
              >
                <Sparkles size={18} aria-hidden="true" />
                <span>完整 AI 规划</span>
                <small>1—14 天 · 1—20 人</small>
              </SegmentedTrigger>
              <SegmentedTrigger
                value="manual"
                id="planning-tab-manual"
                aria-controls="planning-panel-manual"
              >
                <MapPin size={18} aria-hidden="true" />
                <span>手动选点</span>
                <small>2—3 天 · 1—8 人</small>
              </SegmentedTrigger>
            </SegmentedList>
            {message && (
              <p className="unified-mode-message" role="status">
                {message}
              </p>
            )}
          </div>
          {(["ai", "manual"] as const).map((value, panelIndex) => (
            <SegmentedContent
              value={value}
              key={value}
              id={`planning-panel-${value}`}
              aria-labelledby={`planning-tab-${value}`}
            >
              <div
                ref={(element) => {
                  panels.current[panelIndex] = element;
                }}
                className={`unified-panel unified-${value}`}
                onInputCapture={() => {
                  dirty.current[panelIndex] = true;
                }}
                onClickCapture={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest(".trip-brief-form .trip-purpose-grid button")
                  ) {
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
            </SegmentedContent>
          ))}
        </Segmented>
      </main>
    </div>
  );
}

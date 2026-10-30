"use client";

import { useRef } from "react";
import { useConfirmDialog } from "@/components/arc/dialog/confirm-dialog";
import { FullPlanner } from "./full-planner";
import { TripSiteHeader } from "./trip-site-header";
import { useItineraryStore } from "./itinerary-store";
import "./itinerary.css";
import "./planning-workspace.css";

export function PlanningWorkspace({
  startDate,
  mapKey,
  mapsConfigured,
}: {
  startDate: string;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const revision = useItineraryStore((state) => state.version);
  const panel = useRef<HTMLDivElement | null>(null);
  const dirty = useRef(false);
  const { confirm, confirmation } = useConfirmDialog();

  function protectNavigation(href: string) {
    if (panel.current?.querySelector('[aria-busy="true"]')) {
      return false;
    }
    if (href === "/plan") {
      return true;
    }
    const hasForm = panel.current?.querySelector(".trip-brief-form");
    return dirty.current && hasForm
      ? confirm("离开会丢弃本页尚未提交的需求，当前已生成方案不会删除。继续吗？")
      : true;
  }

  return (
    <div className="trip-app unified-planner" data-plan-revision={revision}>
      {confirmation}
      <TripSiteHeader beforeNavigate={protectNavigation} />
      <main id="main" tabIndex={-1}>
        <div
          ref={panel}
          className="unified-panel unified-ai"
          onInputCapture={() => {
            dirty.current = true;
          }}
          onClickCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(".trip-brief-form .trip-purpose-grid button")
            ) {
              dirty.current = true;
            }
          }}
        >
          <FullPlanner
            embedded
            view="new"
            startDate={startDate}
            mapKey={mapKey}
            mapsConfigured={mapsConfigured}
          />
        </div>
      </main>
    </div>
  );
}

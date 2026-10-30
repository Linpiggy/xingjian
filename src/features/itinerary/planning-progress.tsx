import { useEffect, useRef, useState } from "react";
import { Check, MapPin, Route, Sparkles } from "lucide-react";
import type { ItineraryStage, ItineraryWork } from "@/domain/itinerary";
import "./planning-progress.css";

export type GenerationProgress = {
  stage: ItineraryStage;
  work: ItineraryWork | null;
  startedAt: number;
};
const steps = [
  { stage: "places", label: "查找地点", Icon: MapPin },
  { stage: "model", label: "编排行程", Icon: Sparkles },
  { stage: "routes", label: "核对路线", Icon: Route },
] as const;
export function PlanningProgress({
  state,
  message,
  onCancel,
}: {
  state?: GenerationProgress | null;
  message: string;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    heading.current?.focus();
    const started = state?.startedAt ?? Date.now();
    const timer = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [state?.startedAt]);
  const active = Math.max(
    0,
    steps.findIndex((step) => step.stage === state?.stage),
  );
  const work = state?.stage === "routes" ? state.work : null;
  return (
    <section className="planning-progress" aria-label="方案生成进度">
      <div className="planning-progress-heading">
        <h2 ref={heading} tabIndex={-1}>
          正在生成行程
        </h2>
        <span>
          已用时 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </div>
      <ol>
        {steps.map(({ stage, label, Icon }, index) => (
          <li
            key={stage}
            data-state={
              index < active ? "complete" : index === active ? "active" : "waiting"
            }
            aria-current={index === active ? "step" : undefined}
          >
            {index < active ? (
              <Check size={19} aria-hidden="true" />
            ) : (
              <Icon size={19} aria-hidden="true" />
            )}
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <progress
        aria-label="当前阶段进度"
        max={work?.total}
        value={work?.completed}
        aria-valuetext={
          work
            ? `已核对 ${work.completed}/${work.total} 天`
            : `${steps[active].label}进行中，暂无可计算的百分比`
        }
      />
      <p role="status">{message || steps[active].label}</p>
      {work && (
        <span className="planning-progress-count">
          路线核对 {work.completed}/{work.total} 天
        </span>
      )}
      <button type="button" className="button" onClick={onCancel}>
        取消生成
      </button>
    </section>
  );
}

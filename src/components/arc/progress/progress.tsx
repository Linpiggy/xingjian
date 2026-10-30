"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Undefined is indeterminate, never zero.
import type { HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./progress.module.css";

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  value?: number;
  max?: number;
}
export function Progress({
  value,
  max = 100,
  className,
  "aria-valuetext": valueText,
  ...props
}: ProgressProps) {
  const reduced = useReducedMotion();
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const current =
    value !== undefined && Number.isFinite(value)
      ? Math.min(Math.max(value, 0), safeMax)
      : undefined;
  const percentage = current === undefined ? undefined : (current / safeMax) * 100;
  return (
    <div
      {...props}
      className={["arc-component", styles.progress, className].filter(Boolean).join(" ")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={current}
      aria-valuetext={
        valueText ??
        (percentage === undefined ? "进度未知" : `${Math.round(percentage)}%`)
      }
    >
      <div
        className={styles.track}
        data-indeterminate={percentage === undefined ? "true" : undefined}
      >
        {percentage !== undefined && (
          <motion.span
            className={styles.fill}
            initial={false}
            animate={{ x: `${percentage - 100}%` }}
            transition={
              reduced
                ? { duration: 0 }
                : {
                    duration: motionTokens.duration.standard,
                    ease: [...motionTokens.ease.standard],
                  }
            }
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

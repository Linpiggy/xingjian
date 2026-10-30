// Adapted from Arc Library (MIT); see ../LICENSE. Status text does not morph.
import type { HTMLAttributes, ReactNode } from "react";
import styles from "./badge.module.css";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "success" | "info" | "warning" | "danger";
  icon?: ReactNode;
}
export function Badge({
  children,
  className,
  variant = "neutral",
  icon,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={["arc-component", styles.badge, styles.md, styles[variant], className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.content}>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className={styles.text}>{children}</span>
      </span>
    </span>
  );
}

"use client";

import { useId, useState } from "react";
import type { DetailsHTMLAttributes, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./disclosure.module.css";

export function Disclosure({
  title,
  children,
  className,
  open,
  onToggle,
  ...props
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> & { title: ReactNode }) {
  const id = useId();
  const [expanded, setExpanded] = useState(Boolean(open));
  return (
    <details
      {...props}
      open={open}
      className={["arc-component", styles.root, className].filter(Boolean).join(" ")}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        onToggle?.(event);
      }}
    >
      <summary
        id={`${id}-trigger`}
        role="button"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        className={styles.trigger}
      >
        {title}
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div
        id={`${id}-content`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        className={styles.content}
      >
        {children}
      </div>
    </details>
  );
}

"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Keep layout and labels stable.
import { forwardRef, useCallback, useRef } from "react";
import type { ButtonHTMLAttributes, RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"
> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const pressVariants: Variants = {
  pressed: (button: RefObject<HTMLButtonElement | null>) => {
    const width = button.current?.offsetWidth ?? 0;
    return {
      scale: width > 220 ? 0.985 : width && width <= 48 ? 0.96 : 0.97,
      transition: {
        duration: motionTokens.duration.instant,
        ease: [...motionTokens.ease.standard],
      },
    };
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    disabled,
    children,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  const reduced = useReducedMotion();
  const button = useRef<HTMLButtonElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      button.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );
  const popup = props["aria-haspopup"];
  const anchorsLayer = popup !== undefined && popup !== false && popup !== "false";
  const inert =
    disabled ||
    loading ||
    props["aria-disabled"] === true ||
    props["aria-disabled"] === "true";
  return (
    <motion.button
      {...props}
      ref={setRefs}
      type={type}
      tabIndex={props.tabIndex ?? 0}
      className={[
        "arc-component",
        "arc-button",
        styles.button,
        styles[variant],
        styles[size],
        className
          ?.split(/\s+/u)
          .filter((name) => name !== "button" && name !== "primary")
          .join(" "),
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || props["aria-disabled"] || undefined}
      custom={button}
      variants={pressVariants}
      whileTap={reduced || anchorsLayer || inert ? undefined : "pressed"}
      transition={motionTokens.spring.snappy}
      onClick={inert ? (event) => event.preventDefault() : onClick}
    >
      {loading && (
        <span className={styles.loader} aria-hidden="true">
          <span className={styles.spinner} />
        </span>
      )}
      <span
        className={[styles.labelPhase, loading ? styles.loadingLabel : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </span>
    </motion.button>
  );
});

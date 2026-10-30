"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Keep layout and labels stable.
import { forwardRef, useCallback, useRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, RefObject } from "react";
import Link, { type LinkProps } from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./button.module.css";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "place" | "marker" | "index" | "icon";

export function buttonClassName({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; className?: string } = {}) {
  return [
    "arc-component",
    "arc-button",
    styles.button,
    styles[variant],
    styles[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export const ButtonLink = forwardRef<
  HTMLAnchorElement,
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
    Pick<LinkProps, "href" | "prefetch" | "replace" | "scroll"> & {
      variant?: ButtonVariant;
    }
>(function ButtonLink({ variant, className, children, ...props }, ref) {
  return (
    <Link
      {...props}
      ref={ref}
      className={buttonClassName({ variant, className })}
      data-arc-button={variant ?? "secondary"}
    >
      <span className={styles.labelPhase}>{children}</span>
    </Link>
  );
});

export const DragButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function DragButton({ className, children, type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={buttonClassName({
        variant: "icon",
        className: [styles.dragHandle, className].filter(Boolean).join(" "),
      })}
      data-arc-button="icon"
    >
      <span className={styles.labelPhase}>{children}</span>
    </button>
  );
});
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
      className={buttonClassName({ variant, size, className })}
      data-arc-button={variant}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || props["aria-disabled"] || undefined}
      custom={button}
      variants={pressVariants}
      whileTap={
        reduced || anchorsLayer || inert || variant === "marker" ? undefined : "pressed"
      }
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

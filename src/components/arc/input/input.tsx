"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Static controls, stable labels.
import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { CalendarDays, Clock } from "lucide-react";
import { ArcIcon } from "../icon/icon";
import styles from "./input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
  /** 日期／时间输入右侧的原生选择器热区图标 */
  affordance?: "date" | "time";
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    error,
    affordance,
    className,
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    ...props
  },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const messageId = `${inputId}-message`;
  const message = error || description;
  const PickerIcon = affordance === "time" ? Clock : CalendarDays;
  const field = (
    <input
      {...props}
      ref={ref}
      id={inputId}
      className={[
        "arc-component",
        "arc-control",
        "arc-input",
        props.type === "checkbox" || props.type === "radio"
          ? styles.checkbox
          : props.type === "range"
            ? styles.range
            : styles.input,
        affordance ? styles.hasAffordance : undefined,
        label ? undefined : className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : invalid}
      aria-describedby={
        [describedBy, message ? messageId : null].filter(Boolean).join(" ") || undefined
      }
    />
  );
  const control = affordance ? (
    <span className={styles.control}>
      {field}
      <span className={styles.pickerIcon} aria-hidden="true">
        <ArcIcon icon={PickerIcon} size="md" />
      </span>
    </span>
  ) : (
    field
  );
  if (!label) {
    return control;
  }
  return (
    <div className={["arc-component", styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {control}
      {message && (
        <span
          id={messageId}
          role={error ? "alert" : undefined}
          className={error ? styles.error : styles.description}
        >
          {message}
        </span>
      )}
    </div>
  );
});
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={["arc-component", "arc-control", styles.input, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
});
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={[
        "arc-component",
        "arc-control",
        styles.input,
        styles.textarea,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
});
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function Checkbox({ className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={["arc-component", "arc-checkbox", styles.checkbox, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
});

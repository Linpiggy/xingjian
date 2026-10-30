"use client";

// Adapted from Arc Library (MIT); see ../LICENSE. Static controls, stable labels.
import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import styles from "./input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    error,
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
  const control = (
    <input
      {...props}
      ref={ref}
      id={inputId}
      className={[
        "arc-component",
        "arc-control",
        "arc-input",
        styles.input,
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

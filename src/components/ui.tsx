/**
 * 基础交互组件：按钮、可选标签、分段选择、步进器、字段外壳、语音按钮。
 * 全部基于原生元素，保证键盘可达与读屏语义；样式只引用 globals.css 中的设计变量。
 */
"use client";

import { Mic, MicOff, Minus, Plus } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useSpeechInput, useSpeechSupport } from "@/features/voice/speech";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-pine text-white hover:bg-pine-deep disabled:bg-ink-faint shadow-[0_1px_0_rgb(0_0_0/0.15)]",
  secondary: "bg-card text-ink border border-line hover:border-ink-faint hover:bg-paper",
  ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
  danger: "bg-card text-danger border border-line hover:border-danger",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-9 px-3 text-sm gap-1.5",
    md: "h-11 px-4 text-[15px] gap-2",
    lg: "h-13 px-6 text-base gap-2",
  };
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-9 rounded-full border px-3.5 text-sm transition-colors duration-150 ${
        selected
          ? "border-pine bg-pine-soft font-medium text-pine-deep"
          : "border-line bg-card text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-lg bg-paper-deep p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm transition-all duration-150 ${
            value === option.value
              ? "bg-card font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  unit: string;
}) {
  return (
    <div className="flex h-11 items-center justify-between rounded-lg border border-line bg-card">
      <button
        type="button"
        aria-label={`减少${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-full w-11 place-items-center text-ink-soft hover:text-ink disabled:opacity-30"
      >
        <Minus size={16} />
      </button>
      <output aria-live="polite" className="tabular text-[15px] font-medium">
        {value}
        <span className="ml-0.5 text-sm font-normal text-ink-soft">{unit}</span>
      </output>
      <button
        type="button"
        aria-label={`增加${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-full w-11 place-items-center text-ink-soft hover:text-ink disabled:opacity-30"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-lg border border-line bg-card px-3.5 text-[15px] text-ink placeholder:text-ink-faint transition-colors focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine-soft";

/** 语音输入按钮：识别中的文字实时回传，结束后保留在输入框由用户确认 */
export function MicButton({
  onText,
  className = "",
}: {
  onText: (text: string, final: boolean) => void;
  className?: string;
}) {
  const { recognition } = useSpeechSupport();
  const { listening, error, start, stop } = useSpeechInput(onText);
  if (!recognition) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label={listening ? "停止语音输入" : "语音输入"}
      title={error ?? (listening ? "正在聆听，点击结束" : "语音输入")}
      className={`relative grid size-9 place-items-center rounded-full transition-colors ${
        listening
          ? "bg-clay text-white"
          : "text-ink-soft hover:bg-paper-deep hover:text-ink"
      } ${className}`}
    >
      {listening ? <MicOff size={17} /> : <Mic size={17} />}
      {listening ? (
        <span
          className="absolute inset-0 animate-ping rounded-full bg-clay/30"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

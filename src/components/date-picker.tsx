/**
 * 出发日期选择器：月历弹层，直接高亮整段行程（出发日 → 返程日），
 * 悬停时预览选择该日期后的行程范围。支持方向键、PageUp/PageDown、Enter、Esc。
 */
"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { addDays, formatDateLabel } from "@/lib/time";
import { usePopover } from "./popover";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function iso(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** 当月网格：周一开头，前后补齐到整周 */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = iso(year, month, 1 - offset);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

export function DatePicker({
  id,
  value,
  min,
  max,
  span,
  onChange,
}: {
  id?: string;
  value: string;
  min: string;
  max: string;
  /** 行程天数，用于高亮范围 */
  span: number;
  onChange: (value: string) => void;
}) {
  const { open, setOpen, close, root, trigger } = usePopover();
  const [view, setView] = useState(() => parts(value));
  const [focused, setFocused] = useState(value);
  const [hover, setHover] = useState<string | null>(null);
  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);
  const gridRef = useRef<HTMLDivElement>(null);

  const anchor = hover ?? value;
  const end = addDays(anchor, span - 1);

  const openPicker = () => {
    setView(parts(value));
    setFocused(value);
    setOpen(true);
  };

  useEffect(() => {
    if (open) {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
        ?.focus();
    }
  }, [open, focused, view]);

  const moveFocus = (next: string) => {
    const clamped = next < min ? min : next > max ? max : next;
    setFocused(clamped);
    const p = parts(clamped);
    if (p.year !== view.year || p.month !== view.month) {
      setView({ ...p });
    }
  };

  const shiftMonth = (delta: number) => {
    const date = new Date(Date.UTC(view.year, view.month - 1 + delta, 1));
    setView({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in steps) {
      event.preventDefault();
      moveFocus(addDays(focused, steps[event.key]));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const p = parts(focused);
      const date = new Date(
        Date.UTC(p.year, p.month - 1 + (event.key === "PageUp" ? -1 : 1), p.day),
      );
      moveFocus(date.toISOString().slice(0, 10));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (new Date(`${focused}T00:00:00Z`).getUTCDay() + 6) % 7;
      moveFocus(addDays(focused, event.key === "Home" ? -weekday : 6 - weekday));
    }
  };

  const select = (date: string) => {
    onChange(date);
    close();
  };

  const prevDisabled = iso(view.year, view.month, 0) < min;
  const nextDisabled = iso(view.year, view.month + 1, 1) > max;

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPicker())}
        className={`flex h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3.5 text-left transition-colors ${
          open
            ? "border-pine ring-2 ring-pine-soft"
            : "border-line hover:border-ink-faint"
        }`}
      >
        <CalendarDays size={17} className="shrink-0 text-pine" aria-hidden />
        <span className="min-w-0 truncate">
          <span className="text-[15px] text-ink">{formatDateLabel(value)}</span>
          {span > 1 ? (
            <span className="ml-1.5 text-xs text-ink-faint">
              至 {formatDateLabel(addDays(value, span - 1)).split(" ")[0]}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="选择出发日期"
          className="animate-rise absolute left-0 top-[calc(100%+6px)] z-40 w-[312px] rounded-xl border border-line bg-card p-3 shadow-float"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              disabled={prevDisabled}
              onClick={() => shiftMonth(-1)}
              className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-paper-deep disabled:opacity-30"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="font-display text-[15px] text-ink" aria-live="polite">
              {view.year} 年 {view.month} 月
            </span>
            <button
              type="button"
              aria-label="下个月"
              disabled={nextDisabled}
              onClick={() => shiftMonth(1)}
              className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-paper-deep disabled:opacity-30"
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div
            className="grid grid-cols-7 text-center text-[11px] text-ink-faint"
            aria-hidden
          >
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            role="grid"
            className="grid grid-cols-7 gap-y-0.5"
            onKeyDown={onKeyDown}
            onMouseLeave={() => setHover(null)}
          >
            {grid.map((date) => {
              const p = parts(date);
              const outside = p.month !== view.month;
              const disabled = date < min || date > max;
              const inRange = date >= anchor && date <= end;
              const isStart = date === anchor;
              const isEnd = date === end;
              const isWeekend = [0, 6].includes(
                new Date(`${date}T00:00:00Z`).getUTCDay(),
              );
              return (
                <div
                  key={date}
                  role="gridcell"
                  aria-selected={date === value}
                  className={`relative flex h-9 items-center justify-center ${
                    inRange && !disabled
                      ? hover
                        ? "bg-pine-soft/90"
                        : "bg-pine-soft"
                      : ""
                  } ${isStart ? "rounded-l-full" : ""} ${isEnd ? "rounded-r-full" : ""}`}
                >
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focused ? 0 : -1}
                    disabled={disabled}
                    aria-label={`${formatDateLabel(date)}${disabled ? "，不可选" : ""}`}
                    onClick={() => select(date)}
                    onMouseEnter={() => !disabled && setHover(date)}
                    onFocus={() => setFocused(date)}
                    className={`grid size-9 place-items-center rounded-full text-sm tabular transition-colors ${
                      isStart && !disabled
                        ? "bg-pine font-medium text-white"
                        : disabled
                          ? "text-line"
                          : outside
                            ? "text-ink-faint hover:bg-paper-deep"
                            : isWeekend
                              ? "text-clay hover:bg-paper-deep"
                              : "text-ink hover:bg-paper-deep"
                    } ${date === min && !isStart ? "underline decoration-pine decoration-2 underline-offset-4" : ""}`}
                  >
                    {p.day}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 border-t border-line-soft pt-2 text-xs text-ink-faint">
            {formatDateLabel(anchor)}
            {span > 1 ? ` — ${formatDateLabel(end)}，共 ${span} 天` : "，当天往返"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

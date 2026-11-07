/** 时间下拉：半小时粒度 + “不限”，替代浏览器默认的 time 输入框 */
"use client";

import { Check, Clock } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePopover } from "./popover";

const OPTIONS: (string | null)[] = [
  null,
  ...Array.from({ length: 36 }, (_, i) => {
    const minutes = 6 * 60 + i * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 ? "30" : "00"}`;
  }),
];

function period(time: string): string {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? "上午" : hour < 14 ? "中午" : hour < 18 ? "下午" : "晚上";
}

export function TimeSelect({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
}) {
  const { open, setOpen, close, root, trigger } = usePopover();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      const current = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      current?.scrollIntoView({ block: "center" });
      current?.focus();
    }
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = [
      ...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        items[
          Math.min(
            items.length - 1,
            Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
          )
        ];
      next?.focus();
      next?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLElement)?.click();
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3.5 text-left transition-colors ${
          open
            ? "border-pine ring-2 ring-pine-soft"
            : "border-line hover:border-ink-faint"
        }`}
      >
        <Clock size={16} className="shrink-0 text-pine" aria-hidden />
        {value ? (
          <span className="text-[15px] text-ink">
            <span className="tabular">{value}</span>
            <span className="ml-1.5 text-xs text-ink-faint">{period(value)}</span>
          </span>
        ) : (
          <span className="text-[15px] text-ink-faint">{placeholder}</span>
        )}
      </button>
      {open ? (
        <ul
          ref={list}
          role="listbox"
          aria-label={placeholder}
          onKeyDown={onKeyDown}
          className="animate-rise absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-float"
        >
          {OPTIONS.map((option) => {
            const selected = option === value;
            return (
              <li
                key={option ?? "none"}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                onClick={() => {
                  onChange(option);
                  close();
                }}
                className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm outline-none focus:bg-paper-deep ${
                  selected ? "font-medium text-pine-deep" : "text-ink hover:bg-paper-deep"
                }`}
              >
                <span>
                  {option ? (
                    <>
                      <span className="tabular">{option}</span>
                      <span className="ml-2 text-xs text-ink-faint">
                        {period(option)}
                      </span>
                    </>
                  ) : (
                    "不限"
                  )}
                </span>
                {selected ? <Check size={14} aria-hidden /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

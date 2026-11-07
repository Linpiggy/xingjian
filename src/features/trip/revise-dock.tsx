"use client";

import { ArrowUp, Loader2, MessageSquareText, Undo2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { MicButton } from "@/components/ui";
import { cancelAgent, startAgent } from "@/features/agent/agent-client";
import type { TripRecord } from "@/store/trips";
import { useTrips } from "@/store/trips";

const SUGGESTIONS = [
  "第二天轻松一点，少走路",
  "把晚餐换成更地道的本地小馆",
  "如果下雨，换成室内景点",
  "预算紧一点，换更省钱的安排",
  "加一个适合拍照的地方",
];

export function ReviseDock({ record }: { record: TripRecord }) {
  const [text, setText] = useState("");
  const [base, setBase] = useState("");
  const [open, setOpen] = useState(false);
  const undo = useTrips((state) => state.undo);
  const busy = record.run === "revising";
  const trip = record.trip;
  const latest = record.versions.length ? trip?.changeSummary : null;

  const submit = (instruction: string) => {
    const value = instruction.trim();
    if (!trip || value.length < 2 || busy) {
      return;
    }
    setText("");
    setBase("");
    void startAgent(record.id, {
      mode: "revise",
      request: record.request,
      trip,
      instruction: value,
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(text);
  };

  const recent = busy ? record.trace.slice(-3) : [];

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-line bg-card/97 p-3 shadow-float backdrop-blur sm:p-4">
        {busy ? (
          <div
            className="mb-3 space-y-1 border-b border-line-soft pb-3"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-sm font-medium text-ink">
              <span className="flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-pine" aria-hidden />
                AI 正在调整行程
              </span>
              <button
                type="button"
                onClick={() => cancelAgent(record.id)}
                className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                <X size={13} aria-hidden />
                取消
              </button>
            </div>
            {recent.map((item, index) => (
              <p key={index} className="truncate text-xs text-ink-soft">
                {item.kind === "tool"
                  ? `${item.label}${item.summary ? ` — ${item.summary}` : ""}`
                  : item.text.trim()}
              </p>
            ))}
          </div>
        ) : latest ? (
          <div className="mb-3 flex items-start justify-between gap-3 border-b border-line-soft pb-3 text-sm">
            <p className="text-ink-soft">
              <span className="font-medium text-pine">已调整：</span>
              {latest}
            </p>
            <button
              type="button"
              onClick={() => undo(record.id)}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              <Undo2 size={14} aria-hidden />
              撤销
            </button>
          </div>
        ) : null}

        {record.run === "error" && record.error && trip ? (
          <p className="mb-2 text-sm text-danger">{record.error}</p>
        ) : null}

        {!busy && open ? (
          <div className="-mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submit(item)}
                className="shrink-0 rounded-full border border-line-soft bg-paper px-3 py-1 text-xs text-ink-soft transition-colors hover:border-pine hover:text-pine-deep"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpen(false);
            }
          }}
          className="flex items-center gap-2"
        >
          <MessageSquareText
            size={18}
            className="ml-1 hidden shrink-0 text-ink-faint sm:block"
            aria-hidden
          />
          <label htmlFor="revise-input" className="sr-only">
            告诉 AI 想怎么调整
          </label>
          <input
            id="revise-input"
            value={text}
            disabled={busy}
            maxLength={300}
            onChange={(event) => {
              setText(event.target.value);
              setBase(event.target.value);
            }}
            placeholder="想怎么改？比如：第一天下午加个博物馆"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
          />
          <MicButton
            onText={(value, final) => {
              const next = `${base}${value}`.slice(0, 300);
              setText(next);
              if (final) {
                setBase(next);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 2}
            aria-label="发送调整要求"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-pine text-white transition-colors hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint"
          >
            <ArrowUp size={18} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}

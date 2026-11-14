/**
 * 底部 AI 对话栏，两种模式：
 * - 调整行程：把自然语言要求交给规划 Agent，局部重排并可撤销；
 * - 问问 AI：行前问答，结合行程、知识库与高德实时数据回答，不改动行程。
 */
"use client";

import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Radio,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MicButton } from "@/components/ui";
import { cancelAgent, startAgent } from "@/features/agent/agent-client";
import { AnswerText } from "@/features/ask/answer-text";
import { useAsk } from "@/features/ask/use-ask";
import type { TripRecord } from "@/store/trips";
import { useTrips } from "@/store/trips";

const REVISE_SUGGESTIONS = [
  "第二天轻松一点，少走路",
  "把晚餐换成更地道的本地小馆",
  "如果下雨，换成室内景点",
  "预算紧一点，换更省钱的安排",
  "加一个适合拍照的地方",
];

const ASK_SUGGESTIONS = [
  "这些景点需要提前预约吗？",
  "第一天如果下雨怎么办？",
  "带老人的话哪里台阶比较多？",
  "住处附近有便利店和地铁站吗？",
  "有什么值得带回去的伴手礼？",
];

type Mode = "revise" | "ask";

export function ReviseDock({ record }: { record: TripRecord }) {
  const [mode, setMode] = useState<Mode>("revise");
  const [text, setText] = useState("");
  const [base, setBase] = useState("");
  const [focused, setFocused] = useState(false);
  const [threadOpen, setThreadOpen] = useState(true);
  const undo = useTrips((state) => state.undo);
  const { ask, stop, clear, pending, busy: asking } = useAsk(record);
  const revising = record.run === "revising";
  const trip = record.trip;
  const latest = record.versions.length ? trip?.changeSummary : null;
  const chat = record.chat ?? [];
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [chat.length, pending?.answer, pending?.steps.length]);

  const submit = (value: string) => {
    const content = value.trim();
    if (!trip || content.length < 2) {
      return;
    }
    if (mode === "revise") {
      if (revising) {
        return;
      }
      void startAgent(record.id, {
        mode: "revise",
        request: record.request,
        trip,
        instruction: content,
      });
    } else {
      if (asking) {
        return;
      }
      setThreadOpen(true);
      void ask(content);
    }
    setText("");
    setBase("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(text);
  };

  const recent = revising ? record.trace.slice(-3) : [];
  const suggestions = mode === "revise" ? REVISE_SUGGESTIONS : ASK_SUGGESTIONS;
  const showThread = mode === "ask" && threadOpen && (chat.length > 0 || pending);
  const disabled = mode === "revise" ? revising : asking;

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-line bg-card/97 p-3 shadow-float backdrop-blur sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="AI 对话模式"
            className="flex gap-1 rounded-lg bg-paper-deep p-0.5"
          >
            {(
              [
                ["revise", "调整行程", MessageSquareText],
                ["ask", "问问 AI", MessageCircleQuestion],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${
                  mode === value
                    ? "bg-card font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                <Icon size={14} aria-hidden />
                {label}
                {value === "ask" && chat.length ? (
                  <span className="rounded-full bg-pine-soft px-1.5 text-[10px] tabular text-pine-deep">
                    {Math.ceil(chat.length / 2)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {mode === "ask" && chat.length ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setThreadOpen((value) => !value)}
                aria-expanded={threadOpen}
                className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-paper-deep"
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${threadOpen ? "" : "rotate-180"}`}
                  aria-hidden
                />
                {threadOpen ? "收起" : "展开"}
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={asking}
                aria-label="清空问答记录"
                className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-paper-deep hover:text-danger disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : null}
        </div>

        {mode === "revise" ? (
          revising ? (
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
          ) : null
        ) : null}

        {mode === "revise" && record.run === "error" && record.error && trip ? (
          <p className="mb-2 text-sm text-danger">{record.error}</p>
        ) : null}

        {showThread ? (
          <div
            ref={thread}
            className="mb-3 max-h-[45dvh] space-y-4 overflow-y-auto border-b border-line-soft pb-3 pr-1"
            aria-live="polite"
          >
            {chat.map((turn, index) =>
              turn.role === "user" ? (
                <p
                  key={index}
                  className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-pine-soft px-3.5 py-2 text-[15px] text-pine-deep"
                >
                  {turn.content}
                </p>
              ) : (
                <div key={index} className="max-w-[95%]">
                  {turn.error ? (
                    <p className="text-sm text-danger">{turn.content}</p>
                  ) : (
                    <AnswerText text={turn.content} />
                  )}
                  {turn.sources?.length || turn.live ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {turn.live ? (
                        <span className="flex items-center gap-1 rounded-full bg-sky-soft px-2 py-0.5 text-sky">
                          <Radio size={11} aria-hidden />
                          高德实时数据
                        </span>
                      ) : null}
                      {turn.sources?.slice(0, 4).map((source) =>
                        source.url ? (
                          <a
                            key={source.id}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex max-w-56 items-center gap-1 truncate rounded-full bg-pine-soft px-2 py-0.5 text-pine-deep hover:underline"
                          >
                            <ExternalLink size={11} aria-hidden />
                            {source.official ? "官方 · " : ""}
                            <span className="truncate">{source.title}</span>
                          </a>
                        ) : (
                          <span
                            key={source.id}
                            className="flex items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 text-ink-soft"
                          >
                            <BookOpenText size={11} aria-hidden />
                            {source.title}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {pending ? (
              <div className="max-w-[95%]">
                {pending.steps.length ? (
                  <ul className="mb-2 space-y-1">
                    {pending.steps.map((step) => (
                      <li
                        key={step.id}
                        className="flex items-center gap-1.5 text-xs text-ink-faint"
                      >
                        {step.done ? (
                          <Check size={12} className="text-pine" aria-hidden />
                        ) : (
                          <Loader2 size={12} className="animate-spin" aria-hidden />
                        )}
                        {step.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {pending.answer ? (
                  <AnswerText text={pending.answer} streaming />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-ink-faint">
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                    正在想…
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {focused && !disabled ? (
          <div className="-mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {suggestions.map((item) => (
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
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setFocused(false);
            }
          }}
          className="flex items-center gap-2"
        >
          <label
            htmlFor={mode === "revise" ? "revise-input" : "ask-input"}
            className="sr-only"
          >
            {mode === "revise" ? "告诉 AI 想怎么调整" : "向 AI 提问"}
          </label>
          <input
            id={mode === "revise" ? "revise-input" : "ask-input"}
            value={text}
            disabled={disabled}
            maxLength={300}
            onChange={(event) => {
              setText(event.target.value);
              setBase(event.target.value);
            }}
            placeholder={
              mode === "revise"
                ? "想怎么改？比如：第一天下午加个博物馆"
                : "问点什么？比如：灵隐寺要提前预约吗"
            }
            className="ml-1 h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
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
          {mode === "ask" && asking ? (
            <button
              type="button"
              onClick={stop}
              aria-label="停止回答"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper hover:bg-pine-deep"
            >
              <Square size={14} aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || text.trim().length < 2}
              aria-label={mode === "revise" ? "发送调整要求" : "发送问题"}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-pine text-white transition-colors hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint"
            >
              <ArrowUp size={18} aria-hidden />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

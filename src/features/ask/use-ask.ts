/**
 * 行前问答：向 /api/ask 发起流式请求，回答过程保存在本地状态，结束后写入行程记录。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { AskEvent } from "@/lib/schema";
import { useTrips, type ChatTurn, type TripRecord } from "@/store/trips";

export interface PendingAnswer {
  question: string;
  answer: string;
  steps: { id: string; label: string; done: boolean }[];
}

export function useAsk(record: TripRecord) {
  const setChat = useTrips((state) => state.setChat);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const controller = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (question: string) => {
      const trip = record.trip;
      if (!trip || controller.current) {
        return;
      }
      const history = (record.chat ?? [])
        .filter((turn) => !turn.error)
        .slice(-6)
        .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) }));
      const base: ChatTurn[] = [
        ...(record.chat ?? []),
        { role: "user", content: question },
      ];
      setChat(record.id, base);
      const abort = new AbortController();
      controller.current = abort;
      let state: PendingAnswer = { question, answer: "", steps: [] };
      setPending(state);
      const update = (next: Partial<PendingAnswer>) => {
        state = { ...state, ...next };
        setPending(state);
      };
      let final: ChatTurn | null = null;
      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: record.request, trip, question, history }),
          signal: abort.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message ?? `请求失败（HTTP ${response.status}）`);
        }
        await readNdjson<AskEvent>(response, (event) => {
          switch (event.type) {
            case "answer":
              update({ answer: state.answer + event.delta });
              break;
            case "answer_discard":
              update({ answer: "" });
              break;
            case "tool_call":
              update({
                steps: [
                  ...state.steps,
                  { id: event.id, label: event.label, done: false },
                ],
              });
              break;
            case "tool_result":
              update({
                steps: state.steps.map((step) =>
                  step.id === event.id ? { ...step, done: true } : step,
                ),
              });
              break;
            case "sources":
              final = {
                role: "assistant",
                content: state.answer.trim(),
                sources: event.items,
                live: event.live,
                steps: state.steps.map((step) => step.label),
              };
              break;
            case "error":
              final = { role: "assistant", content: event.message, error: true };
              break;
            default:
              break;
          }
        });
        if (!final) {
          final = { role: "assistant", content: "连接中断了，请重试", error: true };
        }
      } catch (error) {
        final = abort.signal.aborted
          ? state.answer.trim()
            ? { role: "assistant", content: `${state.answer.trim()}（已停止）` }
            : null
          : {
              role: "assistant",
              content: error instanceof Error ? error.message : "网络异常，请稍后重试",
              error: true,
            };
      } finally {
        controller.current = null;
        setPending(null);
        setChat(record.id, final ? [...base, final] : base);
      }
    },
    [record, setChat],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const clear = useCallback(() => setChat(record.id, []), [record.id, setChat]);

  return { ask, stop, clear, pending, busy: pending !== null };
}

"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { Itinerary } from "@/domain/itinerary";
import {
  prepareItineraryMove,
  itineraryEdgeKey,
  type ItineraryMove,
  type ItineraryRouteResolution,
} from "@/domain/itinerary-moves";
import { walkingSchema } from "@/lib/contracts";
import { requestJson } from "@/lib/client-api";
import { useItineraryStore } from "./itinerary-store";

export function ItineraryRouteReview({
  before,
  change,
  routes,
  proposalId,
  baseVersion,
  conflicted,
}: {
  before: Itinerary;
  change: ItineraryMove;
  routes: ItineraryRouteResolution[];
  proposalId: number;
  baseVersion: number;
  conflicted: boolean;
}) {
  const controller = useRef<AbortController | null>(null);
  const prepared = prepareItineraryMove(before, change, routes);
  const names = new Map(
    before.days.flatMap((day) =>
      (day.schedule?.items ?? []).map(
        (item) => [item.activity.id, item.activity.place.name] as const,
      ),
    ),
  );
  useEffect(() => () => controller.current?.abort(), []);
  const mutation = useMutation({
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      requestAnimationFrame(() => {
        const state = useItineraryStore.getState();
        if (
          state.plan &&
          state.review?.id === proposalId &&
          state.review.change?.kind === "move" &&
          state.review.plan.status !== "infeasible" &&
          prepareItineraryMove(state.plan, state.review.change, state.review.routes)
            .missing.length === 0
        ) {
          document.getElementById("trip-confirm-change")?.focus();
        }
      });
    },
    mutationFn: async () => {
      const request = new AbortController();
      controller.current = request;
      try {
        for (const gap of prepared.missing) {
          const state = useItineraryStore.getState();
          if (
            state.review?.id !== proposalId ||
            state.version !== baseVersion ||
            request.signal.aborted
          ) {
            throw new Error("行程或预览已变化，未继续查询。");
          }
          if (state.review.plan.status === "infeasible") {
            throw new Error("新路线产生时间冲突，未继续查询；当前方案未修改。");
          }
          const result = await requestJson(
            "/api/routes",
            z.strictObject({ route: walkingSchema }),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ origin: gap.origin, destination: gap.destination }),
              signal: request.signal,
            },
          );
          if (request.signal.aborted) {
            return;
          }
          useItineraryStore
            .getState()
            .resolveMoveRoute(proposalId, baseVersion, { ...gap, route: result.route });
        }
      } catch (cause) {
        if (request.signal.aborted) {
          throw new Error("路线查询已取消，已成功的路段保留；当前方案未修改。");
        }
        throw cause;
      }
    },
  });
  return (
    <section
      className="trip-route-review"
      aria-label="受影响的步行路线"
      aria-busy={mutation.isPending}
    >
      <h3>只更新受影响的路线</h3>
      <ul>
        {prepared.gaps.map((gap) => (
          <li key={itineraryEdgeKey(gap)}>
            <span>
              {names.get(gap.fromActivityId)} → {names.get(gap.toActivityId)}
            </span>
            <strong>
              {prepared.missing.some(
                (item) => itineraryEdgeKey(item) === itineraryEdgeKey(gap),
              )
                ? "待查询"
                : "已查询"}
            </strong>
          </li>
        ))}
      </ul>
      <p>
        查询可能消耗地图配额；未变化的路段不重查。取消不能保证已发出的请求不计费。查询后仍须确认修改。
      </p>
      {mutation.error && (
        <p role="alert" className="trip-error">
          {mutation.error.message}
        </p>
      )}
      <div>
        {prepared.missing.length > 0 && (
          <button
            type="button"
            className="button"
            disabled={mutation.isPending || conflicted}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? "正在查询路线…"
              : routes.length > 0
                ? "补查剩余路线"
                : "查询受影响路线"}
          </button>
        )}
        {mutation.isPending && (
          <button
            type="button"
            className="button"
            onClick={() => controller.current?.abort()}
          >
            取消路线查询
          </button>
        )}
        <span role="status">
          已查询 {prepared.gaps.length - prepared.missing.length}／{prepared.gaps.length}{" "}
          段
        </span>
      </div>
    </section>
  );
}

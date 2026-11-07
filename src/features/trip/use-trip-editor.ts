/**
 * 手动编辑：锁定 / 上下移动 / 删除 / 调整时长 / 替换。
 * 除锁定外，每次编辑都调用 /api/reschedule 用真实路线重排当天时刻，结果作为新版本保存，可撤销。
 */
"use client";

import { useCallback, useState } from "react";
import { distance as formatDistance } from "@/lib/format";
import { distanceMeters } from "@/lib/geo";
import type { Place, Stop, Trip } from "@/lib/schema";
import { useTrips, type TripRecord } from "@/store/trips";

export interface DayEditor {
  busyDay: number | null;
  error: string | null;
  lock: (day: number, index: number) => void;
  move: (day: number, index: number, delta: -1 | 1) => void;
  remove: (day: number, index: number) => void;
  resize: (day: number, index: number, delta: number) => void;
  replace: (day: number, index: number, place: Place) => void;
}

function replacementStop(stop: Stop, place: Place): Stop {
  const meters = Math.round(distanceMeters(stop.place.location, place.location));
  return {
    ...stop,
    place,
    title: place.name,
    description: `你手动选择的${stop.kind === "meal" ? "餐厅" : "地点"}${place.type ? `（${place.type}）` : ""}，距原安排约 ${formatDistance(meters)}。${place.address ? `地址：${place.address}。` : ""}`,
    highlights: [],
    tips: [],
    dishes: [],
    citations: [],
    ticketCny: null,
    mealCny: stop.kind === "meal" ? place.avgCost : null,
    warnings: [],
    userEdited: true,
  };
}

export function useTripEditor(record: TripRecord): DayEditor {
  const commitEdit = useTrips((state) => state.commitEdit);
  const toggleLock = useTrips((state) => state.toggleLock);
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reschedule = useCallback(
    async (trip: Trip, day: number, stops: Stop[], label: string) => {
      setBusyDay(day);
      setError(null);
      try {
        const response = await fetch("/api/reschedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: record.request, trip, day, stops, label }),
        });
        const body = (await response.json()) as { trip?: Trip; message?: string };
        if (!response.ok || !body.trip) {
          throw new Error(body.message ?? "重新排程失败");
        }
        commitEdit(record.id, body.trip);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "重新排程失败");
      } finally {
        setBusyDay(null);
      }
    },
    [commitEdit, record.id, record.request],
  );

  const withDay = useCallback(
    (day: number, change: (stops: Stop[]) => { stops: Stop[]; label: string } | null) => {
      const trip = record.trip;
      const target = trip?.days.find((item) => item.day === day);
      if (!trip || !target || busyDay !== null) {
        return;
      }
      const result = change([...target.stops]);
      if (result) {
        void reschedule(trip, day, result.stops, result.label);
      }
    },
    [record.trip, busyDay, reschedule],
  );

  return {
    busyDay,
    error,
    lock: (day, index) => toggleLock(record.id, day, index),
    move: (day, index, delta) =>
      withDay(day, (stops) => {
        const target = index + delta;
        if (target < 0 || target >= stops.length) {
          return null;
        }
        [stops[index], stops[target]] = [stops[target], stops[index]];
        return {
          stops,
          label: `第 ${day} 天：调整了「${stops[target].place.name}」的顺序`,
        };
      }),
    remove: (day, index) =>
      withDay(day, (stops) => {
        if (stops.length <= 1) {
          return null;
        }
        const [removed] = stops.splice(index, 1);
        return { stops, label: `第 ${day} 天：删除了「${removed.place.name}」` };
      }),
    resize: (day, index, delta) =>
      withDay(day, (stops) => {
        const next = Math.min(480, Math.max(15, stops[index].durationMin + delta));
        if (next === stops[index].durationMin) {
          return null;
        }
        stops[index] = { ...stops[index], durationMin: next, userEdited: true };
        return {
          stops,
          label: `第 ${day} 天：「${stops[index].place.name}」停留改为 ${next} 分钟`,
        };
      }),
    replace: (day, index, place) =>
      withDay(day, (stops) => {
        const previous = stops[index].place.name;
        stops[index] = replacementStop(stops[index], place);
        return { stops, label: `第 ${day} 天：「${previous}」换成了「${place.name}」` };
      }),
  };
}

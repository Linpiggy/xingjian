"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import type { ScheduledActivity } from "@/domain/meal-planning";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import { reservationKey } from "@/domain/meal-reservations";
import { initialVenueFields, buildVenueRules } from "./venue-form";
import { VenueRulesFields } from "./venue-rules-fields";
import { Button } from "@/components/arc/button/button";

export function ItineraryVenueEditor({
  date,
  item,
  onPropose,
}: {
  date: string;
  item: ScheduledActivity;
  onPropose: (change: ItineraryChange) => void;
}) {
  const [fields, setFields] = useState(() =>
    initialVenueFields(item.activity.rules, date, item.activity.place),
  );
  const [error, setError] = useState<string | null>(null);
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const rules = buildVenueRules(
        fields,
        item.activity.place,
        item.activity.rules,
        new Date().toISOString(),
      );
      const beforeKey = reservationKey(date, item.activity);
      const afterKey = reservationKey(date, { ...item.activity, rules });
      const needed =
        item.activity.rules?.reservation.state === "confirmed" && beforeKey !== afterKey;
      if (needed && !fields.releaseConfirmed) {
        throw new Error("原预约为强约束，变更或移除须先明确核对，不会代为取消商家预约。");
      }
      onPropose({
        kind: "venue_rules",
        activityId: item.activity.id,
        rules,
        reservationRelease: needed
          ? { activityId: item.activity.id, beforeKey, afterKey }
          : null,
      });
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? "请核对规则日期、营业时段和预约窗口。"
          : cause instanceof Error
            ? cause.message
            : "规则未应用，请重试。",
      );
    }
  }
  return (
    <details className="trip-venue-editor">
      <summary>编辑营业与预约记录</summary>
      <form onSubmit={preview} noValidate>
        <VenueRulesFields
          kind={item.activity.kind}
          fields={fields}
          hasPlace={true}
          hadConfirmed={item.activity.rules?.reservation.state === "confirmed"}
          collapsible={false}
          onChange={(value) => {
            setFields(value);
            setError(null);
          }}
        />
        <Button type="submit">预览营业与预约</Button>
        {error && (
          <p role="alert" className="trip-error" aria-label="营业预约填写错误">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

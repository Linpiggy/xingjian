"use client";

import { ArrowRight, Accessibility } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  Button,
  Chip,
  Field,
  inputClass,
  MicButton,
  Segmented,
  Stepper,
} from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { PhotoInspiration, type PhotoApply } from "./photo-inspiration";
import { TimeSelect } from "@/components/time-select";
import { QUICK_CITIES } from "@/lib/destinations";
import {
  INTERESTS,
  tripRequestSchema,
  type Pace,
  type Traveler,
  type TripRequest,
} from "@/lib/schema";
import { addDays, todayInShanghai } from "@/lib/time";
import { useTrips } from "@/store/trips";

const TRAVELERS: { value: Traveler; label: string }[] = [
  { value: "solo", label: "独自" },
  { value: "couple", label: "情侣" },
  { value: "friends", label: "朋友" },
  { value: "family", label: "亲子" },
  { value: "elderly", label: "长辈" },
];

const PACES: { value: Pace; label: string }[] = [
  { value: "relaxed", label: "轻松" },
  { value: "balanced", label: "适中" },
  { value: "packed", label: "紧凑" },
];

export function PlannerForm({ initialCity = "" }: { initialCity?: string }) {
  const router = useRouter();
  const createTrip = useTrips((state) => state.create);
  const [form, setForm] = useState<TripRequest>(() => ({
    city: initialCity,
    startDate: addDays(todayInShanghai(), 1),
    days: 3,
    travelers: 2,
    travelerType: "couple",
    budgetPerPerson: null,
    pace: "balanced",
    interests: ["历史文化", "地道美食"],
    mustSee: "",
    foodPreference: "",
    notes: "",
    accessibility: false,
    arrivalTime: null,
    departureTime: null,
    hotelName: "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof TripRequest, string>>>({});
  const [notesBase, setNotesBase] = useState("");

  const set = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /** 拍照识景结果填入表单：城市替换，兴趣合并（最多 6 个），补充说明追加 */
  const applyPhoto = ({ city, interests, note }: PhotoApply) => {
    setForm((current) => ({
      ...current,
      city,
      interests: [...new Set([...interests, ...current.interests])].slice(0, 6),
      notes:
        note && !current.notes.includes(note)
          ? `${current.notes ? `${current.notes}；` : ""}${note}`.slice(0, 500)
          : current.notes,
    }));
    setErrors((current) => ({ ...current, city: undefined }));
  };

  const toggleInterest = (interest: (typeof INTERESTS)[number]) => {
    set(
      "interests",
      form.interests.includes(interest)
        ? form.interests.filter((item) => item !== interest)
        : [...form.interests, interest].slice(-6),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = tripRequestSchema.safeParse({
      ...form,
      hotelName: form.days > 1 ? form.hotelName : "",
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof TripRequest;
        next[key] ??= issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    const id = createTrip(parsed.data);
    router.push(`/plan/${id}`);
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6" aria-label="旅行需求">
      <PhotoInspiration onApply={applyPhoto} />
      <Field label="想去哪里" htmlFor="field-city">
        <input
          id="field-city"
          className={`${inputClass} h-13 text-lg font-medium`}
          placeholder="输入城市，例如 杭州"
          value={form.city}
          onChange={(event) => set("city", event.target.value)}
          aria-invalid={Boolean(errors.city)}
          aria-describedby={errors.city ? "error-city" : undefined}
          autoComplete="off"
        />
        {errors.city ? (
          <p id="error-city" className="mt-1.5 text-sm text-danger">
            {errors.city}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="热门目的地">
          {QUICK_CITIES.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => set("city", city)}
              className={`rounded-md px-2 py-0.5 text-sm transition-colors ${
                form.city === city
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {city}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="出发日期" htmlFor="field-startDate">
          <DatePicker
            id="field-startDate"
            value={form.startDate}
            min={todayInShanghai()}
            max={addDays(todayInShanghai(), 180)}
            span={form.days}
            onChange={(value) => set("startDate", value)}
          />
        </Field>
        <Field label="天数">
          <Stepper
            label="天数"
            unit="天"
            min={1}
            max={7}
            value={form.days}
            onChange={(value) => set("days", value)}
          />
        </Field>
        <Field label="人数">
          <Stepper
            label="人数"
            unit="人"
            min={1}
            max={20}
            value={form.travelers}
            onChange={(value) => set("travelers", value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="第一天几点到" hint="选填" htmlFor="field-arrivalTime">
          <TimeSelect
            id="field-arrivalTime"
            value={form.arrivalTime}
            placeholder="不限，全天可玩"
            onChange={(value) => set("arrivalTime", value)}
          />
        </Field>
        <Field label="最后一天几点走" hint="选填" htmlFor="field-departureTime">
          <TimeSelect
            id="field-departureTime"
            value={form.departureTime}
            placeholder="不限，玩到晚上"
            onChange={(value) => set("departureTime", value)}
          />
        </Field>
        <Field
          label="已订酒店"
          hint={form.days > 1 ? "选填" : "单日无需"}
          htmlFor="field-hotelName"
        >
          <input
            id="field-hotelName"
            className={inputClass}
            placeholder={form.days > 1 ? "不填由 AI 推荐住宿" : "当日往返"}
            disabled={form.days === 1}
            value={form.days > 1 ? form.hotelName : ""}
            maxLength={60}
            onChange={(event) => set("hotelName", event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="和谁一起">
          <Segmented
            label="同行类型"
            value={form.travelerType}
            options={TRAVELERS}
            onChange={(value) => set("travelerType", value)}
          />
        </Field>
        <Field label="旅行节奏">
          <Segmented
            label="旅行节奏"
            value={form.pace}
            options={PACES}
            onChange={(value) => set("pace", value)}
          />
        </Field>
      </div>

      <Field label="感兴趣的" hint="最多 6 项">
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((interest) => (
            <Chip
              key={interest}
              selected={form.interests.includes(interest)}
              onClick={() => toggleInterest(interest)}
            >
              {interest}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="必去的地方" hint="选填" htmlFor="field-mustSee">
          <input
            id="field-mustSee"
            className={inputClass}
            placeholder="如：灵隐寺、西溪湿地"
            value={form.mustSee}
            maxLength={200}
            onChange={(event) => set("mustSee", event.target.value)}
          />
        </Field>
        <Field label="口味与忌口" hint="选填" htmlFor="field-foodPreference">
          <input
            id="field-foodPreference"
            className={inputClass}
            placeholder="如：想吃本帮菜，不吃辣，海鲜过敏"
            value={form.foodPreference}
            maxLength={200}
            onChange={(event) => set("foodPreference", event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="还想告诉 AI 的" hint="可以直接说话" htmlFor="field-notes">
          <div className="relative">
            <textarea
              id="field-notes"
              rows={3}
              maxLength={500}
              className={`${inputClass} h-auto resize-none py-2.5 pr-12 leading-relaxed`}
              placeholder="例如：第一天下午才到；想拍日落；希望晚上有夜景可看"
              value={form.notes}
              onFocus={() => setNotesBase(form.notes)}
              onChange={(event) => {
                set("notes", event.target.value);
                setNotesBase(event.target.value);
              }}
            />
            <span className="absolute right-2 top-2">
              <MicButton
                onText={(text, final) => {
                  const next = `${notesBase}${notesBase ? "，" : ""}${text}`.slice(
                    0,
                    500,
                  );
                  set("notes", next);
                  if (final) {
                    setNotesBase(next);
                  }
                }}
              />
            </span>
          </div>
        </Field>
        <div className="grid content-start gap-4">
          <Field label="人均预算" hint="选填，元" htmlFor="field-budgetPerPerson">
            <input
              id="field-budgetPerPerson"
              inputMode="numeric"
              className={`${inputClass} tabular`}
              placeholder="不限"
              value={form.budgetPerPerson ?? ""}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                set("budgetPerPerson", digits ? Number(digits) : null);
              }}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="size-4 accent-pine"
              checked={form.accessibility}
              onChange={(event) => set("accessibility", event.target.checked)}
            />
            <Accessibility size={16} aria-hidden />
            需要无障碍 / 少步行
          </label>
        </div>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line-soft pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ink-faint">
          地点、路线与天气来自高德开放平台；行程由 AI 生成，出发前请核实开放与预约信息。
        </p>
        <Button type="submit" size="lg" className="sm:min-w-56">
          生成旅行手册
          <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </form>
  );
}

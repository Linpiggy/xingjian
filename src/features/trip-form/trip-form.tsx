"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useConfirmDialog } from "@/components/arc/dialog/confirm-dialog";
import { ArrowRight, Info } from "lucide-react";
import type { PlaceCandidate, TripInput } from "@/domain/models";
import { PlacePicker } from "./place-picker";
import { TripSummary } from "./trip-summary";
import { tripInputSchema } from "@/lib/contracts";
import { parseYuanFen } from "@/lib/money";

function Field({
  name,
  label,
  help,
  error,
  children,
}: {
  name: string;
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {help && <small id={`${name}-help`}>{help}</small>}
      {error && (
        <small className="error-text" id={`${name}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
export function TripForm({
  startDate,
  pending,
  error,
  onSubmit,
  mapKey,
  mapsConfigured,
}: {
  startDate: string;
  pending: boolean;
  error: string | null;
  onSubmit: (input: TripInput) => void;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PlaceCandidate[]>([]);
  const [city, setCity] = useState("杭州");
  const [cityDraft, setCityDraft] = useState("杭州");
  const cityDecision = useRef<Promise<boolean> | null>(null);
  const { confirm, confirmation } = useConfirmDialog();
  async function commitCity() {
    const next = cityDraft.trim();
    if (next === city) {
      return true;
    }
    if (cityDecision.current) {
      return cityDecision.current;
    }
    const decision = selected.length
      ? confirm("更换城市会清空已选地点，继续吗？")
      : Promise.resolve(true);
    cityDecision.current = decision;
    const allowed = await decision;
    if (allowed) {
      setCity(next);
      setCityDraft(next);
      setSelected([]);
    } else {
      setCityDraft(city);
    }
    cityDecision.current = null;
    return allowed;
  }
  const [dayCount, setDayCount] = useState("2");
  const [budget, setBudget] = useState("1500");
  const [departureDate, setDepartureDate] = useState(startDate);
  const [travelers, setTravelers] = useState("2");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cityDraft.trim() !== city || cityDecision.current) {
      setErrors({ city: "请先确认城市变更，再选择该城市地点。" });
      void commitCity();
      return;
    }
    const data = new FormData(event.currentTarget);
    const numeric = (name: string) => {
      const value = String(data.get(name) ?? "").trim();
      return value ? Number(value) : Number.NaN;
    };
    const parsed = tripInputSchema.safeParse({
      city: data.get("city"),
      startDate: data.get("startDate"),
      dayCount: numeric("dayCount"),
      travelers: numeric("travelers"),
      budgetPerPersonFen:
        parseYuanFen(String(data.get("budgetPerPersonFen") ?? "")) ?? Number.NaN,
      keywords: selected.map((candidate) => candidate.place.name),
      selections: selected.map((candidate) => candidate.selection),
      stayMinutes: numeric("stayMinutes"),
      bufferMinutes: numeric("bufferMinutes"),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[String(issue.path[0])] ??= issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      const field = document.getElementById(first);
      (field ?? document.getElementById("selected-places"))?.focus();
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }
  const describe = (name: string) =>
    `${name}-help${errors[name] ? ` ${name}-error` : ""}`;
  return (
    <div className="form-layout">
      {confirmation}
      <section className="panel">
        <form noValidate onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend>旅行信息</legend>
            <div className="field-grid">
              <Field
                name="city"
                label="目的地城市"
                help="输入本次旅行的目的地。"
                error={errors.city}
              >
                <input
                  id="city"
                  name="city"
                  value={cityDraft}
                  onChange={(event) => setCityDraft(event.target.value)}
                  onBlur={() => {
                    void commitCity();
                  }}
                  autoComplete="address-level2"
                  maxLength={40}
                  aria-invalid={!!errors.city}
                  aria-describedby={describe("city")}
                />
              </Field>
              <Field
                name="startDate"
                label="出行日期"
                help="选择开始旅行的日期。"
                error={errors.startDate}
              >
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  value={departureDate}
                  onChange={(event) => setDepartureDate(event.target.value)}
                  aria-invalid={!!errors.startDate}
                  aria-describedby={describe("startDate")}
                />
              </Field>
              <Field
                name="dayCount"
                label="旅行天数"
                help="安排同一城市的 2-3 天旅行。"
                error={errors.dayCount}
              >
                <select
                  id="dayCount"
                  name="dayCount"
                  value={dayCount}
                  onChange={(event) => setDayCount(event.target.value)}
                  aria-invalid={!!errors.dayCount}
                  aria-describedby={describe("dayCount")}
                >
                  <option value="2">2 天</option>
                  <option value="3">3 天</option>
                </select>
              </Field>
              <Field
                name="travelers"
                label="同行人数"
                help="1-8 人。"
                error={errors.travelers}
              >
                <input
                  id="travelers"
                  name="travelers"
                  type="number"
                  min={1}
                  max={8}
                  value={travelers}
                  onChange={(event) => setTravelers(event.target.value)}
                  aria-invalid={!!errors.travelers}
                  aria-describedby={describe("travelers")}
                />
              </Field>
              <Field
                name="budgetPerPersonFen"
                label="每人预算（元）"
                help="预算目标，不是已核实的旅行费用。"
                error={errors.budgetPerPersonFen}
              >
                <input
                  id="budgetPerPersonFen"
                  name="budgetPerPersonFen"
                  type="number"
                  min={0}
                  max={100000}
                  step="0.01"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  aria-invalid={!!errors.budgetPerPersonFen}
                  aria-describedby={describe("budgetPerPersonFen")}
                />
              </Field>
            </div>
          </fieldset>
          <fieldset disabled={pending}>
            <legend>想去的地点</legend>
            <PlacePicker
              city={city}
              dayCount={Number(dayCount)}
              budgetPerPersonFen={parseYuanFen(budget)}
              selected={selected}
              onChange={(places) => {
                setSelected(places);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.keywords;
                  delete next.selections;
                  return next;
                });
              }}
              error={errors.keywords ?? errors.selections}
              mapKey={mapKey}
              mapsConfigured={mapsConfigured}
            />
            <div className="field-grid spacing">
              <Field
                name="stayMinutes"
                label="每处停留（分钟）"
                help="你设定的估算，15-240 分钟。"
                error={errors.stayMinutes}
              >
                <input
                  id="stayMinutes"
                  name="stayMinutes"
                  type="number"
                  min={15}
                  max={240}
                  defaultValue={90}
                  aria-invalid={!!errors.stayMinutes}
                  aria-describedby={describe("stayMinutes")}
                />
              </Field>
              <Field
                name="bufferMinutes"
                label="路段缓冲（分钟）"
                help="在真实步行耗时之外另加，0-60 分钟。"
                error={errors.bufferMinutes}
              >
                <input
                  id="bufferMinutes"
                  name="bufferMinutes"
                  type="number"
                  min={0}
                  max={60}
                  defaultValue={15}
                  aria-invalid={!!errors.bufferMinutes}
                  aria-describedby={describe("bufferMinutes")}
                />
              </Field>
            </div>
          </fieldset>
          <div className="notice">
            <Info size={18} aria-hidden="true" />
            <p>搜索与 AI 推荐可以混合添加。生成后请确认地点、开放时间与预约要求。</p>
          </div>
          {error && (
            <div role="alert" aria-label="行程查询失败" className="notice danger">
              {error} 输入已保留，可以修改后重试。
            </div>
          )}
          <div className="form-actions">
            <small>草稿只保留在当前页面，刷新后不保存。</small>
            <button className="button primary" disabled={pending} type="submit">
              {pending ? "正在查询" : "生成路线草稿"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
          {pending && (
            <div role="status" className="skeleton-lines">
              <span />
              <span />
              <p>正在获取地点和路线，请稍候。</p>
            </div>
          )}
        </form>
      </section>
      <TripSummary
        city={city}
        departureDate={departureDate}
        dayCount={Number(dayCount)}
        travelers={travelers}
        budgetPerPersonFen={parseYuanFen(budget)}
        selected={selected}
      />
    </div>
  );
}

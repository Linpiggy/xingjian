"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, MapPin, Users, Wallet } from "lucide-react";
import {
  tripPurposes,
  tripPurposeLabels,
  type TripBrief,
  type TripPurpose,
} from "@/domain/trip-brief";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";
import { parseYuanFen } from "@/lib/money";

export function BriefForm({
  startDate,
  initial,
  pending,
  progress,
  error,
  onSubmit,
  onCancel,
}: {
  startDate: string;
  initial: TripBrief | null;
  pending: boolean;
  progress: string;
  error: string | null;
  onSubmit: (brief: TripBrief) => void;
  onCancel: () => void;
}) {
  const [purpose, setPurpose] = useState<TripPurpose>(initial?.mainPurpose ?? "culture");
  const [secondary, setSecondary] = useState<TripPurpose[]>(
    initial?.secondaryPurposes ?? [],
  );
  const [validation, setValidation] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const number = (name: string) => (text(name) ? Number(text(name)) : NaN);
    const lines = (name: string) =>
      text(name)
        .split(/[\n、]/)
        .map((value) => value.trim())
        .filter(Boolean);
    const minute = (name: string, end = false) => {
      const value = text(name);
      if (!/^\d{2}:\d{2}$/.test(value)) {
        return NaN;
      }
      const [hours, minutes] = value.split(":").map(Number);
      return end && hours === 0 && minutes === 0 ? 1440 : hours * 60 + minutes;
    };
    const parsed = tripBriefSchema.safeParse({
      destinationCity: text("city"),
      originCity: text("origin") || null,
      startDate: text("date"),
      dayCount: number("days"),
      travelers: number("travelers"),
      budget: {
        amountFen: parseYuanFen(text("budget")) ?? NaN,
        basis: text("basis"),
        includeIntercity: data.has("intercity"),
        includeLodging: data.has("lodging"),
      },
      availability: {
        firstDayStartMinute: minute("first"),
        lastDayEndMinute: minute("last", true),
        dailyStartMinute: minute("dailyStart"),
        dailyEndMinute: minute("dailyEnd", true),
      },
      mainPurpose: purpose,
      secondaryPurposes: secondary,
      pace: text("pace"),
      mustVisit: lines("mustVisit"),
      mustEat: [
        ...lines("dishes").map((name) => ({ kind: "dish", name })),
        ...lines("restaurants").map((name) => ({ kind: "restaurant", name })),
      ],
      dietary: { avoid: lines("avoid"), allergies: lines("allergies") },
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "destinationCity");
      const names: Record<string, string> = {
        destinationCity: "city",
        startDate: "date",
        dayCount: "days",
        travelers: "travelers",
        budget: "budget",
        mustVisit: "mustVisit",
        mustEat: "dishes",
        dietary: issue?.path[1] === "allergies" ? "allergies" : "avoid",
        availability:
          (
            {
              firstDayStartMinute: "first",
              lastDayEndMinute: "last",
              dailyStartMinute: "dailyStart",
              dailyEndMinute: "dailyEnd",
            } as Record<string, string>
          )[String(issue?.path[1])] ?? "first",
      };
      setValidation(
        issue?.code === "invalid_type"
          ? field === "budget"
            ? "请填写有效预算金额，最多两位小数。"
            : "请完整填写有效的天数、人数和时间。"
          : (issue?.message ?? "请检查旅行需求。"),
      );
      const target = event.currentTarget.elements.namedItem(names[field] ?? "city");
      if (target instanceof HTMLElement) {
        const details = target.closest("details");
        if (details) {
          details.open = true;
        }
        target.focus();
      }
      return;
    }
    if (!data.has("consent")) {
      setValidation("生成会使用模型和地图查询配额，请先确认本次查询。");
      (event.currentTarget.elements.namedItem("consent") as HTMLInputElement)?.focus();
      return;
    }
    setValidation(null);
    onSubmit(parsed.data);
  }
  const time = (value: number) =>
    `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <form
      className="trip-brief-form"
      onSubmit={submit}
      onInput={() => setValidation(null)}
      noValidate
      aria-busy={pending}
    >
      <fieldset disabled={pending}>
        <legend>先确定，这趟旅行的边界</legend>
        <div className="trip-fields">
          <label>
            <span>
              <MapPin size={16} aria-hidden="true" />
              目的地城市
            </span>
            <input
              name="city"
              autoComplete="address-level2"
              placeholder="想去的城市"
              defaultValue={initial?.destinationCity ?? ""}
              maxLength={40}
            />
          </label>
          <label>
            <span>
              <CalendarDays size={16} aria-hidden="true" />
              出发日期
            </span>
            <input
              name="date"
              type="date"
              defaultValue={initial?.startDate ?? startDate}
            />
          </label>
          <label>
            <span>旅行天数</span>
            <input
              name="days"
              type="number"
              min={1}
              max={14}
              defaultValue={initial?.dayCount ?? 3}
            />
            <small>1—14 天，同一城市</small>
          </label>
          <label>
            <span>
              <Users size={16} aria-hidden="true" />
              同行人数
            </span>
            <input
              name="travelers"
              type="number"
              min={1}
              max={20}
              defaultValue={initial?.travelers ?? 2}
            />
            <small>1—20 人</small>
          </label>
          <label>
            <span>
              <Wallet size={16} aria-hidden="true" />
              预算金额（元）
            </span>
            <input
              name="budget"
              type="text"
              inputMode="decimal"
              defaultValue={
                initial ? (initial.budget.amountFen / 100).toFixed(2) : "1500"
              }
            />
          </label>
          <label>
            <span>预算口径</span>
            <select name="basis" defaultValue={initial?.budget.basis ?? "per_person"}>
              <option value="per_person">每人全程</option>
              <option value="total">所有人合计</option>
            </select>
          </label>
        </div>
        <div className="trip-checks">
          <label>
            <input
              name="lodging"
              type="checkbox"
              defaultChecked={initial?.budget.includeLodging ?? true}
            />
            预算包含住宿
          </label>
          <label>
            <input
              name="intercity"
              type="checkbox"
              defaultChecked={initial?.budget.includeIntercity ?? false}
            />
            预算包含跨城往返
          </label>
        </div>
        <details className="trip-disclosure">
          <summary>抵达／离开时间与每天可用时段</summary>
          <p>时间按上海时区安排；首末日只使用你实际可用的时间。</p>
          <div className="trip-fields">
            <label>
              <span>首日可用开始</span>
              <input
                name="first"
                type="time"
                defaultValue={time(initial?.availability.firstDayStartMinute ?? 540)}
              />
            </label>
            <label>
              <span>末日最晚结束</span>
              <input
                name="last"
                type="time"
                defaultValue={time(initial?.availability.lastDayEndMinute ?? 1260)}
              />
            </label>
            <label>
              <span>每天开始游玩</span>
              <input
                name="dailyStart"
                type="time"
                defaultValue={time(initial?.availability.dailyStartMinute ?? 540)}
              />
            </label>
            <label>
              <span>每天结束游玩</span>
              <input
                name="dailyEnd"
                type="time"
                defaultValue={time(initial?.availability.dailyEndMinute ?? 1260)}
              />
            </label>
            <label>
              <span>出发城市（选填）</span>
              <input
                name="origin"
                defaultValue={initial?.originCity ?? ""}
                maxLength={40}
              />
            </label>
            <label>
              <span>旅行节奏</span>
              <select name="pace" defaultValue={initial?.pace ?? "balanced"}>
                <option value="relaxed">轻松一点</option>
                <option value="balanced">松紧适中</option>
                <option value="packed">充实紧凑</option>
              </select>
            </label>
          </div>
        </details>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>这趟旅行，最看重什么？</legend>
        <div className="trip-purpose-grid" role="group" aria-label="主要旅行目的">
          {tripPurposes.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={purpose === value}
              onClick={() => {
                setPurpose(value);
                setSecondary(secondary.filter((item) => item !== value));
              }}
            >
              {tripPurposeLabels[value]}
            </button>
          ))}
        </div>
        <details className="trip-disclosure">
          <summary>再加一些次要偏好</summary>
          <div className="trip-checks">
            {tripPurposes
              .filter((value) => value !== purpose)
              .map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={secondary.includes(value)}
                    onChange={(event) =>
                      setSecondary(
                        event.target.checked
                          ? [...secondary, value]
                          : secondary.filter((item) => item !== value),
                      )
                    }
                  />
                  {tripPurposeLabels[value]}
                </label>
              ))}
          </div>
        </details>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>
          不能错过的，留给我来安排 <small>选填</small>
        </legend>
        <div className="trip-fields">
          <label>
            <span>必去公共地点</span>
            <textarea
              name="mustVisit"
              placeholder="每行一个明确地点名称；没有也可留空"
              defaultValue={initial?.mustVisit.join("\n")}
            />
          </label>
          <label>
            <span>必吃菜品</span>
            <textarea
              name="dishes"
              placeholder="每行一个菜品；供应情况仍需向商家核实"
              defaultValue={initial?.mustEat
                .filter((item) => item.kind === "dish")
                .map((item) => item.name)
                .join("\n")}
            />
          </label>
        </div>
        <details className="trip-disclosure">
          <summary>指定餐厅、忌口与过敏原</summary>
          <div className="trip-fields">
            <label>
              <span>必吃餐厅</span>
              <textarea
                name="restaurants"
                defaultValue={initial?.mustEat
                  .filter((item) => item.kind === "restaurant")
                  .map((item) => item.name)
                  .join("\n")}
                placeholder="每行一家明确餐厅"
              />
            </label>
            <label>
              <span>忌口</span>
              <textarea
                name="avoid"
                defaultValue={initial?.dietary.avoid.join("\n")}
                placeholder="每行一项"
              />
            </label>
            <label>
              <span>过敏原记录</span>
              <textarea
                name="allergies"
                defaultValue={initial?.dietary.allergies.join("\n")}
                placeholder="不能凭 AI 判断过敏安全，仍须与商家确认"
              />
            </label>
          </div>
        </details>
      </fieldset>
      <p className="trip-privacy">
        偏好会交给所配置的 AI
        分析，请勿填写证件、票据、联系方式或精确住址。查询可能消耗模型与地图配额；只查询候选及实际相邻路段，不查询全量路线矩阵。
      </p>
      <label className="trip-consent">
        <input name="consent" type="checkbox" disabled={pending} />
        我确认本次生成会使用模型与地图查询配额
      </label>
      {(validation || error) && (
        <p className="trip-error" role="alert">
          {validation || error}
        </p>
      )}
      {pending ? (
        <div className="trip-pending">
          <p role="status">{progress || "正在准备旅行方案…"}</p>
          <button type="button" className="button" onClick={onCancel}>
            取消生成
          </button>
        </div>
      ) : (
        <button type="submit" className="trip-generate">
          生成我的完整方案 <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}

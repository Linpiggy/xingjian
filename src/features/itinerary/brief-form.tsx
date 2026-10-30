"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  Check,
  Landmark,
  Trees,
  Utensils,
  Coffee,
  Camera,
  Store,
  Compass,
} from "lucide-react";

import {
  tripPurposes,
  tripPurposeLabels,
  type TripBrief,
  type TripPurpose,
} from "@/domain/trip-brief";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";
import { parseYuanFen } from "@/lib/money";
import type { PlanningRequestError } from "./request-itinerary";
import type { SocialInspiration } from "@/domain/social-inspiration";
import { SocialInspirationInput } from "./social-inspiration-input";
import { PlanningProgress, type GenerationProgress } from "./planning-progress";
import { BriefPlaceSearch } from "./brief-place-search";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import {
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  SegmentedContent,
} from "@/components/arc/segmented/segmented";

const purposeVisuals = {
  local_life: { icon: Store, description: "街巷、市场与当地日常" },
  culture: { icon: Landmark, description: "博物馆、古迹与城市故事" },
  nature: { icon: Trees, description: "山水、公园与户外风景" },
  food: { icon: Utensils, description: "地方风味与特色餐食" },
  relaxation: { icon: Coffee, description: "慢一点，留出休息时间" },
  photography: { icon: Camera, description: "地标、光影与观景视角" },
};

export function BriefForm({
  startDate,
  initial,
  pending,
  progress,
  generation,
  error,
  failure,
  cooldown = 0,
  onSubmit,
  onCancel,
  onBackToPlan,
  onDraftChange,
}: {
  startDate: string;
  initial: TripBrief | null;
  pending: boolean;
  progress: string;
  generation?: GenerationProgress | null;
  error: string | null;
  failure?: PlanningRequestError | null;
  cooldown?: number;
  onSubmit: (brief: TripBrief) => void;
  onCancel: () => void;
  onBackToPlan?: () => void;
  onDraftChange?: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      const submit = form.current?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submit && !submit.disabled) {
        submit.focus();
      } else {
        form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
      }
    }
    wasPending.current = pending;
  }, [pending]);
  const [purpose, setPurpose] = useState<TripPurpose>(initial?.mainPurpose ?? "culture");
  const [secondary, setSecondary] = useState<TripPurpose[]>(
    initial?.secondaryPurposes ?? [],
  );
  const [validation, setValidation] = useState<string | null>(null);
  const [mustVisitText, setMustVisitText] = useState(initial?.mustVisit.join("\n") ?? "");
  const [section, setSection] = useState(0);
  const [socialInspiration, setSocialInspiration] = useState<
    SocialInspiration | undefined
  >(initial?.socialInspiration);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [summary, setSummary] = useState({
    city: initial?.destinationCity ?? "",
    date: initial?.startDate ?? startDate,
    days: String(initial?.dayCount ?? 3),
    travelers: String(initial?.travelers ?? 2),
    amount: initial ? (initial.budget.amountFen / 100).toFixed(2) : "1500",
    basis: initial?.budget.basis ?? "per_person",
    lodging: initial?.budget.includeLodging ?? true,
    intercity: initial?.budget.includeIntercity ?? false,
  });
  function trackInput(event: FormEvent<HTMLFormElement>) {
    setValidation(null);
    const values = new FormData(event.currentTarget);
    const value = (key: string) => String(values.get(key) ?? "");
    setSummary({
      city: value("city"),
      date: value("date"),
      days: value("days"),
      travelers: value("travelers"),
      amount: value("budget"),
      basis: value("basis") === "total" ? "total" : "per_person",
      lodging: values.has("lodging"),
      intercity: values.has("intercity"),
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sourceBusy) {
      setValidation("请等待本地笔记读取完成后再生成。");
      return;
    }
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
      ...(socialInspiration ? { socialInspiration } : {}),
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
        socialInspiration: "socialInspiration",
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
        setSection(
          target.closest("[data-brief-panel]")?.getAttribute("data-brief-panel") ===
            "preferences"
            ? 1
            : 0,
        );
        requestAnimationFrame(() => {
          if (target.isConnected) {
            target.focus();
          }
        });
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
  const PurposeIcon = purposeVisuals[purpose].icon;
  const summaryBudgetFen = parseYuanFen(summary.amount);
  const time = (value: number) =>
    `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <Segmented
      value={String(section)}
      onValueChange={(value) => setSection(Number(value))}
      asChild
    >
      <form
        ref={form}
        data-generating={pending ? "true" : undefined}
        className="trip-brief-form"
        onSubmit={submit}
        onInput={trackInput}
        noValidate
        aria-busy={pending || sourceBusy}
      >
        <div className="trip-form-layout">
          <div className="trip-form-sheet">
            <SegmentedList className="trip-section-nav" aria-label="规划表单分区">
              <SegmentedTrigger
                value="0"
                id="brief-tab-basics"
                aria-controls="brief-basics"
                disabled={pending}
              >
                <CalendarDays size={16} aria-hidden="true" />
                行程概况
              </SegmentedTrigger>
              <SegmentedTrigger
                value="1"
                id="brief-tab-preferences"
                aria-controls="brief-preferences"
                disabled={pending}
              >
                <Compass size={16} aria-hidden="true" />
                偏好与必去
              </SegmentedTrigger>
            </SegmentedList>
            <SegmentedContent
              value="0"
              aria-labelledby="brief-tab-basics"
              className="trip-pane"
              id="brief-basics"
              data-brief-panel="basics"
              hidden={section !== 0}
            >
              <fieldset disabled={pending}>
                <legend>先确定，这趟旅行的边界</legend>
                <div className="trip-fields">
                  <Input
                    label="目的地城市"
                    name="city"
                    autoComplete="address-level2"
                    placeholder="想去的城市"
                    defaultValue={initial?.destinationCity ?? ""}
                    maxLength={40}
                  />
                  <Input
                    label="出发日期"
                    name="date"
                    type="date"
                    defaultValue={initial?.startDate ?? startDate}
                  />
                  <Input
                    label="旅行天数"
                    name="days"
                    type="number"
                    min={1}
                    max={14}
                    defaultValue={initial?.dayCount ?? 3}
                    description="1—14 天，同一城市"
                  />
                  <Input
                    label="同行人数"
                    name="travelers"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={initial?.travelers ?? 2}
                    description="1—20 人"
                  />
                  <Input
                    label="预算金额（元）"
                    name="budget"
                    type="text"
                    inputMode="decimal"
                    defaultValue={
                      initial ? (initial.budget.amountFen / 100).toFixed(2) : "1500"
                    }
                  />
                  <label>
                    <span id="brief-budget-basis-label">预算口径</span>
                    <select
                      aria-labelledby="brief-budget-basis-label"
                      name="basis"
                      defaultValue={initial?.budget.basis ?? "per_person"}
                    >
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
                        defaultValue={time(
                          initial?.availability.firstDayStartMinute ?? 540,
                        )}
                      />
                    </label>
                    <label>
                      <span>末日最晚结束</span>
                      <input
                        name="last"
                        type="time"
                        defaultValue={time(
                          initial?.availability.lastDayEndMinute ?? 1260,
                        )}
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
            </SegmentedContent>
            <SegmentedContent
              value="1"
              aria-labelledby="brief-tab-preferences"
              className="trip-pane"
              id="brief-preferences"
              data-brief-panel="preferences"
              hidden={section !== 1}
            >
              <fieldset disabled={pending}>
                <legend>这趟旅行，最看重什么？</legend>
                <div className="trip-purpose-grid" role="group" aria-label="主要旅行目的">
                  {tripPurposes.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={purpose === value}
                      aria-label={tripPurposeLabels[value]}
                      onClick={() => {
                        setPurpose(value);
                        setSecondary(secondary.filter((item) => item !== value));
                      }}
                    >
                      {(() => {
                        const Icon = purposeVisuals[value].icon;
                        return <Icon size={19} strokeWidth={1.6} aria-hidden="true" />;
                      })()}
                      <span>
                        {tripPurposeLabels[value]}
                        <small>{purposeVisuals[value].description}</small>
                      </span>
                      {purpose === value && (
                        <Check
                          size={15}
                          className="trip-purpose-check"
                          aria-hidden="true"
                        />
                      )}
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
                  必去与必吃 <small>选填</small>
                </legend>
                <div className="trip-fields">
                  <label>
                    <span>必去公共地点</span>
                    <textarea
                      name="mustVisit"
                      placeholder="每行一个明确地点名称；没有也可留空"
                      value={mustVisitText}
                      onChange={(event) => setMustVisitText(event.target.value)}
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
              <fieldset disabled={pending}>
                <BriefPlaceSearch
                  city={summary.city}
                  names={mustVisitText
                    .split(/[\n、]/)
                    .map((name) => name.trim())
                    .filter(Boolean)}
                  pending={pending}
                  onAdd={(name) => {
                    setMustVisitText((previous) =>
                      previous.trim() ? `${previous.trim()}\n${name}` : name,
                    );
                    setValidation(null);
                    onDraftChange?.();
                  }}
                />
              </fieldset>
              <fieldset disabled={pending}>
                <legend>
                  带上社交旅行灵感 <small>选填</small>
                </legend>
                <SocialInspirationInput
                  city={summary.city}
                  value={socialInspiration}
                  pending={pending}
                  onChange={(value) => {
                    setSocialInspiration(value);
                    setValidation(null);
                    onDraftChange?.();
                  }}
                  onBusyChange={setSourceBusy}
                />
              </fieldset>
            </SegmentedContent>
            <div className="trip-form-footer">
              <details className="trip-privacy">
                <summary>生成与隐私说明</summary>
                <p>
                  偏好会交给所配置的 AI
                  分析，请勿填写证件、票据、联系方式或精确住址。查询可能消耗模型与地图配额；只查询候选及实际相邻路段，不查询全量路线矩阵。
                </p>
              </details>
              <label className="trip-consent">
                <input name="consent" type="checkbox" disabled={pending} />
                我确认本次生成会使用模型与地图查询配额
              </label>
              {(validation || error) && (
                <p className="trip-error" role="alert" tabIndex={-1}>
                  {validation || error}
                </p>
              )}
              {error && failure && (
                <details className="trip-disclosure trip-failure-details">
                  <summary>查看错误原因</summary>
                  <p>
                    阶段：
                    {failure.stage
                      ? { places: "地点搜索", model: "AI 规划", routes: "路线与排程" }[
                          failure.stage
                        ]
                      : "连接与响应"}
                    {" · "}错误代码：{failure.code}
                  </p>
                  <p>未自动重试；再次生成可能消耗查询与模型额度，输入和原方案仍保留。</p>
                </details>
              )}
              {cooldown > 0 && (
                <p className="trip-operation-status" role="status">
                  请等待 {cooldown} 秒后手动重试，不会自动发送请求。
                </p>
              )}
              {pending ? (
                <PlanningProgress
                  state={generation}
                  message={progress}
                  onCancel={onCancel}
                />
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  className="trip-generate"
                  disabled={cooldown > 0 || sourceBusy}
                >
                  生成我的完整方案 <ArrowRight size={18} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          <aside className="trip-entry-aside" aria-label="本次旅行摘要">
            <div className="trip-summary-heading">
              <span>此行概览</span>
              <Compass size={21} strokeWidth={1.4} aria-hidden="true" />
            </div>
            <div className="trip-intent-visual" aria-hidden="true">
              <PurposeIcon size={48} strokeWidth={1.3} />
              <div>
                <CalendarDays size={21} />
                <MapPin size={21} />
                <Utensils size={21} />
              </div>
            </div>
            <h2>{summary.city.trim() || "目的地待定"}</h2>
            <p className="trip-summary-date">
              {summary.date ? summary.date.replaceAll("-", ".") : "出发日期待定"}
            </p>
            <div className="trip-summary-scale">
              <span>
                <strong>{summary.days || "—"}</strong> 天
              </span>
              <span>
                <strong>{summary.travelers || "—"}</strong> 人同行
              </span>
            </div>
            <dl className="trip-summary-list">
              <div>
                <dt>旅行主题</dt>
                <dd>{tripPurposeLabels[purpose]}</dd>
              </div>
              <div>
                <dt>
                  {summary.basis === "total" ? "全体全程预算目标" : "每人全程预算目标"}
                </dt>
                <dd>
                  {summaryBudgetFen === null
                    ? "待填写"
                    : new Intl.NumberFormat("zh-CN", {
                        style: "currency",
                        currency: "CNY",
                      }).format(summaryBudgetFen / 100)}
                </dd>
              </div>
              <div>
                <dt>预算计入</dt>
                <dd>
                  {summary.lodging ? "含住宿" : "不含住宿"} ·{" "}
                  {summary.intercity ? "含跨城往返" : "不含跨城往返"}
                </dd>
              </div>
            </dl>
            <div className="trip-summary-inclusion">
              <Check size={15} aria-hidden="true" />
              <p>每日活动、三餐建议与相邻步行路线，按你的可用时间安排。</p>
            </div>
            <p className="trip-aside-note">
              营业、预约、天气与真实价格仍须核实。费用为目标参考，不是报价或达标承诺。
            </p>
            {onBackToPlan && (
              <Button className="button" onClick={onBackToPlan}>
                返回当前方案
              </Button>
            )}
          </aside>
        </div>
      </form>
    </Segmented>
  );
}

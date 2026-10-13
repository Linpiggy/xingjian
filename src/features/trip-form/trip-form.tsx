"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import type { TripInput } from "@/domain/models";
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
}: {
  startDate: string;
  pending: boolean;
  error: string | null;
  onSubmit: (input: TripInput) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      keywords: String(data.get("keywords") ?? "")
        .split(/[\n,，;；]/)
        .map((x) => x.trim())
        .filter(Boolean),
      stayMinutes: numeric("stayMinutes"),
      bufferMinutes: numeric("bufferMinutes"),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[String(issue.path[0])] ??= issue.message;
      }
      setErrors(next);
      document.getElementById(Object.keys(next)[0])?.focus();
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }
  const describe = (name: string) =>
    `${name}-help${errors[name] ? ` ${name}-error` : ""}`;
  return (
    <div className="form-layout">
      <section className="panel">
        <form noValidate onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend>旅行信息</legend>
            <div className="field-grid">
              <Field
                name="city"
                label="目的地城市"
                help="杭州是可修改的示例城市。"
                error={errors.city}
              >
                <input
                  id="city"
                  name="city"
                  defaultValue="杭州"
                  autoComplete="address-level2"
                  maxLength={40}
                  aria-invalid={!!errors.city}
                  aria-describedby={describe("city")}
                />
              </Field>
              <Field
                name="startDate"
                label="出行日期"
                help="开放、预约与天气仍需核实。"
                error={errors.startDate}
              >
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={startDate}
                  aria-invalid={!!errors.startDate}
                  aria-describedby={describe("startDate")}
                />
              </Field>
              <Field
                name="dayCount"
                label="旅行天数"
                help="本轮支持单城市 2-3 日。"
                error={errors.dayCount}
              >
                <select id="dayCount" name="dayCount" defaultValue="2">
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
                  defaultValue={2}
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
                  defaultValue={1500}
                  aria-invalid={!!errors.budgetPerPersonFen}
                  aria-describedby={describe("budgetPerPersonFen")}
                />
              </Field>
            </div>
          </fieldset>
          <fieldset disabled={pending}>
            <legend>想去的地点</legend>
            <Field
              name="keywords"
              label="地点名称"
              help="每行一个，2-6 个；按填写顺序分天。下面仅是可修改的输入示例。"
              error={errors.keywords}
            >
              <textarea
                id="keywords"
                name="keywords"
                rows={5}
                defaultValue={
                  "浙江省博物馆孤山馆\n西湖博物馆\n中国丝绸博物馆\n浙江美术馆"
                }
                aria-invalid={!!errors.keywords}
                aria-describedby={describe("keywords")}
              />
            </Field>
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
            <p>
              查询真实高德地点与步行路线；本轮不生成 AI 推荐，也不安排餐饮或查询天气。
            </p>
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
      <aside className="panel form-note">
        <h2>一份可以核实的计划</h2>
        <p>先获取真实地点和交通，再补齐完整行程。</p>
        <hr />
        <h3>本轮已经能做</h3>
        <ul>
          <li>查询高德地点和真实步行耗时</li>
          <li>切换每天的行程，查看地点来源</li>
          <li>地图 Key 配置后绘制真实路线</li>
        </ul>
        <div className="notice warning">
          <p>
            缺信息就显示未知。开放、预约、餐饮、返程与完整预算尚未校验，草稿不能当作已确认的出行方案。
          </p>
        </div>
      </aside>
    </div>
  );
}

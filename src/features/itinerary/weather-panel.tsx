"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import type { Place } from "@/domain/models";
import {
  hasPrecipitationSignal,
  roundWeatherLocation,
  type WeatherPeriod,
} from "@/domain/weather";
import { requestJson } from "@/lib/client-api";
import { weatherReportSchema } from "@/lib/weather-contracts";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";

const timestamp = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

function Period({ period, label }: { period: WeatherPeriod | null; label: string }) {
  return (
    <div>
      <h3>{label}</h3>
      <p>{period?.description ?? "天气现象未知"}</p>
      <p className="small muted">
        降水概率：
        {period?.probability == null
          ? "未知"
          : `${Math.round(period.probability * 100)}%`}
        ；降水量：{period?.amountMm == null ? "未知" : `${period.amountMm} mm`}。
      </p>
      {period && (
        <p className="small muted">
          预报时段：{timestamp(period.startsAt)} 至 {timestamp(period.endsAt)}。
        </p>
      )}
    </div>
  );
}

export function WeatherPanel({ date, place }: { date: string; place: Place }) {
  const [mainland, setMainland] = useState(false);
  const query = useQuery({
    queryKey: ["daily-weather", date, place.id, ...place.location],
    enabled: false,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await requestJson(
        "/api/weather",
        z.object({ report: weatherReportSchema }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            location: place.location,
            coordinateSystem: "GCJ-02",
            region: "CN-mainland",
          }),
          signal,
        },
      );
      if (response.report.date !== date) {
        throw new Error("天气日期与当前行程不一致，未使用此数据。");
      }
      const source = response.report.source;
      const rounded = roundWeatherLocation(place.location);
      if (
        source &&
        (source.location[0] !== rounded[0] || source.location[1] !== rounded[1])
      ) {
        throw new Error("天气参考位置与查询不一致，未使用此数据。");
      }
      return response.report;
    },
  });
  const report = query.data;
  const day = report?.day;
  const source = report?.source;
  const rain =
    hasPrecipitationSignal(day?.daytime ?? null) ||
    hasPrecipitationSignal(day?.nighttime ?? null);
  return (
    <section
      className="panel weather-panel"
      aria-label="当天天气"
      aria-busy={query.isFetching}
    >
      <div className="panel-heading">
        <div>
          <h2>当天天气</h2>
          <p className="small muted">{date} · 参考当天首个地点查询大陆日级预报。</p>
        </div>
        <Button
          type="button"

          disabled={query.isFetching || !mainland}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "查询中…" : report ? "刷新天气" : "查询天气"}
        </Button>
      </div>
      <label className="weather-confirm">
        <Input
          type="checkbox"
          checked={mainland}
          onChange={(event) => setMainland(event.target.checked)}
        />
        确认参考地点「{place.name}」位于中国大陆
      </label>
      <p className="small muted">其他地区坐标系未支持；坐标范围检查不能判断国境。</p>
      <p className="small muted spacing">
        手动查询可能消耗接口配额；日级预报不保证某个游览小时的天气，不自动改变行程。
      </p>
      {query.isFetching && <p role="status">正在查询天气，当前安排保持不变。</p>}
      {query.isError && (
        <div role="alert" aria-label="天气查询失败" className="notice warning spacing">
          {query.error.message}{" "}
          {report ? "显示此前查询结果，未保证最新。" : "当前天气未知。"}
        </div>
      )}
      {!report && !query.isFetching && !query.isError && (
        <p className="notice spacing">天气尚未查询，不能据此判断晴雨。</p>
      )}
      {source?.kind === "fixture" && (
        <p className="notice warning spacing">测试天气 fixture，非实时预报。</p>
      )}
      {report?.status === "unknown" && (
        <p className="notice spacing">
          {report.reason === "out_of_range"
            ? "日期超出每日预报查询范围，天气未知。"
            : report.reason === "partial_coverage"
              ? "预报未覆盖完整日期，剩余时段天气未知。"
              : "返回数据没有覆盖此日期，天气未知。"}
        </p>
      )}
      {day && (
        <>
          <p className="spacing">
            温度：{day.minC === null ? "最低温未知" : `${day.minC} °C`} /{" "}
            {day.maxC === null ? "最高温未知" : `${day.maxC} °C`}
          </p>
          <div className="weather-periods spacing">
            <Period period={day.daytime} label="白天" />
            <Period period={day.nighttime} label="夜间（可能延续到次日）" />
          </div>
          {rain && (
            <p className="notice warning spacing">
              预报有降水信号，请核实室外安排并准备备选；未删除或更改已锁定地点。
            </p>
          )}
        </>
      )}
      {source && (
        <div className="weather-source spacing small muted">
          <p>
            和风天气 · 日级预报 · 查询 {timestamp(source.queriedAt)}；供应商更新时间未知。
          </p>
          <p>查询采用大陆 GCJ-02 坐标，按接口保留两位小数，约 1 公里分辨率。</p>
          {source.attributions.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      )}
    </section>
  );
}

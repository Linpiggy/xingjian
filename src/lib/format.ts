import type { Day, LegMode, Stop, Trip, TripRequest } from "./schema";
import { formatDateLabel } from "./time";

export function money(value: number | null): string {
  return value === null ? "未知" : `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

export function duration(minutes: number | null): string {
  if (minutes === null) {
    return "时长未知";
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

export function distance(meters: number | null): string {
  if (meters === null) {
    return "";
  }
  return meters < 1000
    ? `${Math.round(meters)} 米`
    : `${(meters / 1000).toFixed(1)} 公里`;
}

export const LEG_LABEL: Record<LegMode, string> = {
  walking: "步行",
  transit: "公交/地铁",
  taxi: "打车",
};

export const MEAL_LABEL = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "小食",
} as const;

export function stopLabel(stop: Stop): string {
  if (stop.kind === "meal") {
    return stop.mealType ? MEAL_LABEL[stop.mealType] : "用餐";
  }
  return stop.kind === "rest" ? "休憩" : "游览";
}

export const TRAVELER_TEXT: Record<TripRequest["travelerType"], string> = {
  solo: "独自出行",
  couple: "两人同行",
  friends: "朋友结伴",
  family: "亲子家庭",
  elderly: "陪伴长辈",
};

export const PACE_TEXT: Record<TripRequest["pace"], string> = {
  relaxed: "轻松节奏",
  balanced: "适中节奏",
  packed: "紧凑节奏",
};

/** 把一天的安排转成适合朗读的口语文本 */
export function dayNarration(day: Day): string {
  const parts = [`第${day.day}天，${formatDateLabel(day.date)}，主题是${day.theme}。`];
  if (day.weather) {
    parts.push(
      `天气预报${day.weather.dayWeather}，${day.weather.low}到${day.weather.high}度。`,
    );
  }
  day.stops.forEach((stop, index) => {
    const leg = index > 0 ? day.legs[index - 1] : null;
    if (leg) {
      parts.push(`${LEG_LABEL[leg.mode]}${leg.minutes ? `约${leg.minutes}分钟` : ""}，`);
    }
    parts.push(
      `${stop.start}，${stopLabel(stop)}：${stop.place.name}。${stop.description}`,
    );
  });
  return parts.join("");
}

/** 导出为 Markdown 文本，便于复制到笔记或分享给同伴 */
export function tripToMarkdown(trip: Trip, request: TripRequest): string {
  const lines = [
    `# ${trip.title}`,
    "",
    `> ${trip.subtitle}`,
    "",
    `${request.city} · ${request.days} 天 · ${request.travelers} 人 · ${TRAVELER_TEXT[request.travelerType]}`,
    "",
    trip.overview,
    "",
    ...(trip.intercity?.outbound
      ? [
          `去程：${trip.intercity.outbound.trip} ${trip.intercity.outbound.from} ${trip.intercity.outbound.depart} → ${trip.intercity.outbound.to} ${trip.intercity.outbound.arrive}`,
        ]
      : []),
    ...(trip.intercity?.inbound
      ? [
          `返程：${trip.intercity.inbound.trip} ${trip.intercity.inbound.from} ${trip.intercity.inbound.depart} → ${trip.intercity.inbound.to} ${trip.intercity.inbound.arrive}`,
          "",
        ]
      : []),
    ...(trip.hotel ? [`住宿：${trip.hotel.place.name}——${trip.hotel.reason}`, ""] : []),
  ];
  for (const day of trip.days) {
    lines.push(`## 第 ${day.day} 天 · ${formatDateLabel(day.date)} · ${day.theme}`, "");
    if (day.weather) {
      lines.push(
        `天气：${day.weather.dayWeather} ${day.weather.low}~${day.weather.high}℃`,
        "",
      );
    }
    day.stops.forEach((stop, index) => {
      const leg = index > 0 ? day.legs[index - 1] : null;
      if (leg) {
        lines.push(`  ↓ ${LEG_LABEL[leg.mode]} ${duration(leg.minutes)} ${leg.summary}`);
      }
      lines.push(
        `- **${stop.start}–${stop.end} ${stopLabel(stop)}｜${stop.place.name}**：${stop.description}`,
      );
      if (stop.dishes.length) {
        lines.push(`  推荐：${stop.dishes.join("、")}`);
      }
      for (const tip of stop.tips) {
        lines.push(`  提示：${tip}`);
      }
    });
    lines.push("");
  }
  lines.push(`## 预算（每人）`, "");
  lines.push(
    `门票 ${money(trip.budget.tickets)}｜餐饮 ${money(trip.budget.meals)}｜交通 ${money(trip.budget.transport)}｜住宿 ${money(trip.budget.hotel)}${trip.budget.intercity !== null ? `｜往返车票 ${money(trip.budget.intercity)}` : ""}｜合计约 ${money(trip.budget.total)}`,
    "",
  );
  if (trip.tips.length) {
    lines.push("## 贴士", "", ...trip.tips.map((tip) => `- ${tip.text}`), "");
  }
  lines.push("—— 由「行间」AI 旅行规划 Agent 生成，出行前请核实开放与预约信息。");
  return lines.join("\n");
}

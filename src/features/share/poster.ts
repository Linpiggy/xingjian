/**
 * 行程长图海报：用 Canvas 2D 直接绘制（无第三方依赖），先排版计算总高度，再一次性绘制。
 * 只使用同源的目的地封面图，避免跨域图片污染画布导致无法导出。
 */
"use client";

import { destinationFor } from "@/lib/destinations";
import { proxiedPhoto } from "@/lib/photo";
import { describeTrain } from "@/lib/train";
import { LEG_LABEL, money, PACE_TEXT, stopLabel, TRAVELER_TEXT } from "@/lib/format";
import type { Trip, TripRequest } from "@/lib/schema";
import { addDays, formatDateLabel } from "@/lib/time";

const WIDTH = 1080;
const PAD = 80;
const COLORS = {
  paper: "#f6f1e7",
  card: "#fffdf8",
  ink: "#1d1914",
  soft: "#5c5348",
  faint: "#8d8274",
  line: "#ddd2bf",
  pine: "#1f5a47",
  clay: "#b0512a",
  sky: "#2d5b78",
};
const SERIF = '"Noto Serif SC Variable", "Songti SC", serif';
const SANS = '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif';

type Ctx = CanvasRenderingContext2D;

const NO_LINE_START = "，。、；：！？）》」』”’…·";

/** 按字符断行（中文没有空格分词），最多 maxLines 行，超出加省略号 */
function wrap(ctx: Ctx, text: string, width: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    // 避头标点：句读不放在行首，允许略微超出行宽
    if (
      ctx.measureText(line + char).width > width &&
      line &&
      !NO_LINE_START.includes(char)
    ) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      line += char;
    }
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
  } else if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  return lines;
}

/** 按“铺满裁切”方式把图片画进圆角矩形 */
function drawCover(
  ctx: Ctx,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(
    image,
    (image.width - sw) / 2,
    (image.height - sh) / 2,
    sw,
    sh,
    x,
    y,
    w,
    h,
  );
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** 确保海报用到的字形分片已下载，否则 Canvas 会用回退字体绘制 */
async function ensureFonts(text: string) {
  const sample = [...new Set(text)].join("");
  await Promise.all([
    document.fonts.load(`600 48px ${SERIF}`, sample),
    document.fonts.load(`400 28px ${SANS}`, sample),
    document.fonts.load(`600 28px ${SANS}`, sample),
  ]).catch(() => undefined);
}

function collectText(trip: Trip, request: TripRequest): string {
  return [
    trip.title,
    trip.subtitle,
    trip.overview,
    request.city,
    ...trip.days.flatMap((day) => [
      day.theme,
      ...day.stops.map((stop) => `${stop.place.name}${stop.title}`),
    ]),
    ...trip.tips.map((tip) => tip.text),
    "去程返程车票往第天日一二三四五六游览午餐晚餐早餐小食休憩步行公交地铁打车分钟人均预算住宿门票餐饮交通由行间旅行规划生成出发前请核实开放与预约信息约周人同行",
  ].join("");
}

export async function renderPoster(trip: Trip, request: TripRequest): Promise<Blob> {
  await ensureFonts(collectText(trip, request));
  const destination = destinationFor(request.city);
  const cover = destination ? await loadImage(destination.photo) : null;
  // 景点实景图经同源代理加载，画布不会被跨域图片污染，可以正常导出
  const photoUrls = [
    ...new Set(trip.days.flatMap((day) => day.stops.map((stop) => stop.place.photos[0]))),
  ].filter((url): url is string => Boolean(url));
  const thumbs = new Map<string, HTMLImageElement | null>(
    await Promise.all(
      photoUrls.map(async (url) => [url, await loadImage(proxiedPhoto(url))] as const),
    ),
  );

  const measureCanvas = document.createElement("canvas");
  const measure = measureCanvas.getContext("2d") as Ctx;

  // 两遍：第一遍只计算高度，第二遍真正绘制
  const draw = (ctx: Ctx, paint: boolean): number => {
    let y = 0;
    const content = WIDTH - PAD * 2;

    // 封面
    const coverHeight = 760;
    if (paint) {
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(0, 0, WIDTH, ctx.canvas.height);
      if (cover) {
        const scale = Math.max(WIDTH / cover.width, coverHeight / cover.height);
        const w = cover.width * scale;
        const h = cover.height * scale;
        ctx.drawImage(cover, (WIDTH - w) / 2, (coverHeight - h) / 2, w, h);
      } else {
        ctx.fillStyle = COLORS.pine;
        ctx.fillRect(0, 0, WIDTH, coverHeight);
      }
      const gradient = ctx.createLinearGradient(0, coverHeight * 0.25, 0, coverHeight);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, WIDTH, coverHeight);
    }
    ctx.font = `600 76px ${SERIF}`;
    const titleLines = wrap(ctx, trip.title, content, 3);
    ctx.font = `400 32px ${SANS}`;
    const subtitleLines = trip.subtitle ? wrap(ctx, trip.subtitle, content, 2) : [];
    let cy = coverHeight - 72 - 40 - subtitleLines.length * 48 - titleLines.length * 92;
    if (paint) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `600 34px ${SERIF}`;
      ctx.fillText(request.city, PAD, cy - 28);
      ctx.fillStyle = "#ffffff";
      ctx.font = `600 76px ${SERIF}`;
      titleLines.forEach((line, i) => ctx.fillText(line, PAD, cy + 76 + i * 92));
    }
    cy += titleLines.length * 92 + 16;
    if (paint) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `400 32px ${SANS}`;
      subtitleLines.forEach((line, i) => ctx.fillText(line, PAD, cy + 32 + i * 48));
      const end = addDays(request.startDate, request.days - 1);
      ctx.font = `400 26px ${SANS}`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(
        `${formatDateLabel(request.startDate)}${request.days > 1 ? ` — ${formatDateLabel(end)}` : ""} · ${request.days} 天 · ${request.travelers} 人 · ${TRAVELER_TEXT[request.travelerType]} · ${PACE_TEXT[request.pace]}`,
        PAD,
        coverHeight - 48,
      );
    }
    y = coverHeight + 72;

    // 总览
    ctx.font = `400 30px ${SANS}`;
    const overview = wrap(ctx, trip.overview, content, 6);
    if (paint) {
      ctx.fillStyle = COLORS.soft;
      overview.forEach((line, i) => ctx.fillText(line, PAD, y + 30 + i * 50));
    }
    y += overview.length * 50 + 48;

    // 预算条
    const parts: [string, number | null][] = [
      ["门票", trip.budget.tickets],
      ["餐饮", trip.budget.meals],
      ["交通", trip.budget.transport],
      ["住宿", trip.budget.hotel],
    ];
    if (trip.intercity?.outbound || trip.intercity?.inbound) {
      parts.push(["车票", trip.budget.intercity]);
    }
    const boxHeight = Math.max(150, 40 + Math.ceil(parts.length / 2) * 48);
    if (paint) {
      ctx.fillStyle = COLORS.card;
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(PAD, y, content, boxHeight, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.faint;
      ctx.font = `400 24px ${SANS}`;
      ctx.fillText("人均预算（估）", PAD + 36, y + 52);
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 56px ${SERIF}`;
      ctx.fillText(money(trip.budget.total), PAD + 36, y + 118);
      ctx.font = `400 24px ${SANS}`;
      parts.forEach(([label, value], i) => {
        const x = PAD + 380 + (i % 2) * 260;
        const row = y + 62 + Math.floor(i / 2) * 48;
        ctx.fillStyle = COLORS.faint;
        ctx.fillText(label, x, row);
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(money(value), x + 70, row);
      });
    }
    y += boxHeight + 40;
    // 中转车次可能很长，逐段描述并自动换行
    ctx.font = `500 26px ${SANS}`;
    const trainLines = [
      trip.intercity?.outbound && `去程 ${describeTrain(trip.intercity.outbound)}`,
      trip.intercity?.inbound && `返程 ${describeTrain(trip.intercity.inbound)}`,
    ]
      .filter((line): line is string => Boolean(line))
      .flatMap((line) => wrap(ctx, line, content, 3));
    if (trainLines.length) {
      if (paint) {
        ctx.fillStyle = COLORS.ink;
        trainLines.forEach((line, i) => ctx.fillText(line, PAD, y + 26 + i * 40));
      }
      y += trainLines.length * 40 + 12;
    }
    if (trip.hotel) {
      ctx.font = `400 26px ${SANS}`;
      const hotelLines = wrap(ctx, `住在 ${trip.hotel.place.name}`, content, 2);
      if (paint) {
        ctx.fillStyle = COLORS.sky;
        hotelLines.forEach((line, i) => ctx.fillText(line, PAD, y + 26 + i * 40));
      }
      y += hotelLines.length * 40 + 24;
    }

    // 每一天
    for (const day of trip.days) {
      y += 48;
      if (paint) {
        ctx.fillStyle = COLORS.pine;
        ctx.font = `600 120px ${SERIF}`;
        ctx.fillText(String(day.day).padStart(2, "0"), PAD - 6, y + 100);
        ctx.fillStyle = COLORS.soft;
        ctx.font = `400 26px ${SANS}`;
        ctx.fillText(
          `第 ${day.day} 天 · ${formatDateLabel(day.date)}${day.weather ? ` · ${day.weather.dayWeather} ${day.weather.low}°–${day.weather.high}°` : ""}`,
          PAD + 180,
          y + 40,
        );
      }
      ctx.font = `600 48px ${SERIF}`;
      const themeLines = wrap(ctx, day.theme, content - 180, 2);
      if (paint) {
        ctx.fillStyle = COLORS.ink;
        themeLines.forEach((line, i) => ctx.fillText(line, PAD + 180, y + 100 + i * 58));
      }
      y += Math.max(124, 52 + themeLines.length * 58) + 16;
      if (paint) {
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(PAD, y, content, 3);
      }
      y += 36;

      day.stops.forEach((stop, index) => {
        const leg = index > 0 ? day.legs[index - 1] : null;
        if (leg) {
          if (paint) {
            ctx.fillStyle = COLORS.line;
            ctx.fillRect(PAD + 151, y - 8, 2, 52);
            ctx.fillStyle = COLORS.faint;
            ctx.font = `400 22px ${SANS}`;
            ctx.fillText(
              `${LEG_LABEL[leg.mode]}${leg.minutes != null ? ` ${leg.minutes} 分钟` : ""}`,
              PAD + 176,
              y + 24,
            );
          }
          y += 48;
        }
        const thumb = stop.place.photos[0] ? thumbs.get(stop.place.photos[0]) : null;
        const thumbW = 200;
        const thumbH = 150;
        const textWidth = content - 200 - (thumb ? thumbW + 24 : 0);
        ctx.font = `600 32px ${SANS}`;
        const nameLines = wrap(ctx, stop.place.name, textWidth, 2);
        const extra =
          stop.kind === "meal" && stop.dishes.length
            ? ` · ${stop.dishes.slice(0, 3).join("、")}`
            : "";
        ctx.font = `400 24px ${SANS}`;
        const metaLines = wrap(
          ctx,
          `${stopLabel(stop)} · ${stop.start}–${stop.end}${extra}`,
          textWidth,
          2,
        );
        if (paint) {
          ctx.fillStyle = COLORS.ink;
          ctx.font = `600 32px ${SERIF}`;
          ctx.fillText(stop.start, PAD, y + 34);
          ctx.fillStyle = stop.kind === "meal" ? COLORS.clay : COLORS.pine;
          ctx.beginPath();
          ctx.arc(PAD + 152, y + 23, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS.ink;
          ctx.font = `600 32px ${SANS}`;
          nameLines.forEach((line, i) => ctx.fillText(line, PAD + 184, y + 34 + i * 44));
          ctx.fillStyle = COLORS.faint;
          ctx.font = `400 24px ${SANS}`;
          metaLines.forEach((line, i) =>
            ctx.fillText(line, PAD + 184, y + 38 + nameLines.length * 44 + i * 34),
          );
          if (thumb) {
            drawCover(ctx, thumb, WIDTH - PAD - thumbW, y, thumbW, thumbH, 14);
          }
        }
        const textHeight = nameLines.length * 44 + metaLines.length * 34 + 30;
        y += thumb ? Math.max(textHeight, thumbH + 28) : textHeight;
      });
    }

    // 贴士
    if (trip.tips.length) {
      y += 56;
      if (paint) {
        ctx.fillStyle = COLORS.ink;
        ctx.font = `600 44px ${SERIF}`;
        ctx.fillText("出发前看一眼", PAD, y + 44);
      }
      y += 80;
      ctx.font = `400 28px ${SANS}`;
      for (const tip of trip.tips.slice(0, 4)) {
        const lines = wrap(ctx, tip.text, content - 40, 3);
        if (paint) {
          ctx.fillStyle = COLORS.pine;
          ctx.fillText("·", PAD, y + 28);
          ctx.fillStyle = COLORS.soft;
          lines.forEach((line, i) => ctx.fillText(line, PAD + 36, y + 28 + i * 44));
        }
        y += lines.length * 44 + 20;
      }
    }

    // 页脚
    y += 48;
    if (paint) {
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(PAD, y, content, 2);
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 36px ${SERIF}`;
      ctx.fillText("行间", PAD, y + 70);
      ctx.fillStyle = COLORS.faint;
      ctx.font = `400 22px ${SANS}`;
      ctx.fillText(
        "AI 旅行规划 Agent 生成 · 出发前请核实开放与预约信息",
        PAD + 90,
        y + 66,
      );
      if (destination) {
        ctx.fillText(
          `封面摄影 ${destination.credit.author} · ${destination.credit.license}`,
          PAD,
          y + 110,
        );
      }
    }
    return y + 150;
  };

  const height = draw(measure, false);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  draw(canvas.getContext("2d") as Ctx, true);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("海报生成失败"))),
      "image/png",
    ),
  );
}

/** 分钟数与 HH:mm 互转，跨午夜时保留超过 24:00 的表示以便发现超时 */
export function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function toClock(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** 从高德营业时间文本里取出第一段“HH:mm-HH:mm”，取不到返回 null（视为未知） */
export function parseOpenWindow(
  text: string | null,
): { open: number; close: number } | null {
  if (!text) {
    return null;
  }
  const match = /(\d{1,2}:\d{2})\s*[-~至]\s*(次日)?(\d{1,2}:\d{2})/.exec(text);
  if (!match) {
    return null;
  }
  const open = toMinutes(match[1]);
  let close = toMinutes(match[3]);
  if (open === null || close === null) {
    return null;
  }
  if (match[2] || close <= open) {
    close += 24 * 60;
  }
  return { open, close };
}

/** YYYY-MM-DD 加天数，按 UTC 计算避免时区偏移 */
export function addDays(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

export function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month}月${day}日 周${"日一二三四五六"[weekday]}`;
}

export function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

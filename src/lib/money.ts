// Parse decimal text without floating point multiplication. Values are integer fen.
export function parseYuanFen(value: string): number | null {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

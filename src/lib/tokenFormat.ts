function parseTokenCount(value: string | null | undefined): bigint | null {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
}

/** Summary: choose the unit before rounding; keep all arithmetic in integers. */
export function formatTokenCount(value: string | null | undefined): string {
  const count = parseTokenCount(value);
  if (count === null) return "—";
  if (count < 10000n) return count.toString();
  const unit = count < 100000000n ? 10000n : 100000000n;
  const suffix = count < 100000000n ? "万" : "亿";
  const hundredths = (count * 100n + unit / 2n) / unit;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}${suffix}`;
}

/** Detail: group the exact decimal digits without a Number conversion. */
export function formatTokenCountExact(value: string | null | undefined): string {
  const count = parseTokenCount(value);
  return count === null ? "—" : count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

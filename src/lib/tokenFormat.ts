/** All arithmetic stays in integers, including rounding across suffix boundaries. */
export function formatTokenCount(value: string | null | undefined): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "—";
  const count = BigInt(value);
  if (count < 1000n) return count.toString();
  const suffixes = ["", "K", "M", "B", "T", "Q", "E"];
  let unit = 1000n;
  let index = 1;
  while (index < suffixes.length - 1 && count >= unit * 1000n) { unit *= 1000n; index++; }
  let tenths = (count * 10n + unit / 2n) / unit;
  if (tenths >= 10000n && index < suffixes.length - 1) {
    unit *= 1000n; index++;
    tenths = (count * 10n + unit / 2n) / unit;
  }
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ""}${suffixes[index]}`;
}

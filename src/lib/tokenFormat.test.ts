import { describe, expect, it } from "vitest";
import { formatTokenCount, formatTokenCountExact } from "./tokenFormat";

describe("token display formats", () => {
  it.each([
    ["0", "0", "0"],
    ["9999", "9999", "9,999"],
    ["10000", "1.00万", "10,000"],
    ["99999999", "10000.00万", "99,999,999"],
    ["100000000", "1.00亿", "100,000,000"],
    ["12685398", "1268.54万", "12,685,398"],
    ["1300000000", "13.00亿", "1,300,000,000"],
    ["10049", "1.00万", "10,049"],
    ["10050", "1.01万", "10,050"],
    ["100499999", "1.00亿", "100,499,999"],
    ["100500000", "1.01亿", "100,500,000"],
    ["9007199254740993", "90071992.55亿", "9,007,199,254,740,993"],
    ["9223372036854775807", "92233720368.55亿", "9,223,372,036,854,775,807"],
    ["18446744073709551615", "184467440737.10亿", "18,446,744,073,709,551,615"],
    ["000", "0", "0"],
    ["00010000", "1.00万", "10,000"],
  ])("formats %s as summary %s and exact detail %s", (input, summary, exact) => {
    expect(formatTokenCount(input)).toBe(summary);
    expect(formatTokenCountExact(input)).toBe(exact);
  });

  it.each([null, undefined, "", "-1", "NaN", "1.5", "1e4", "10,000", " 10000", "10000 "])(
    "keeps invalid or missing input %s distinct from zero", (input) => {
      expect(formatTokenCount(input)).toBe("—");
      expect(formatTokenCountExact(input)).toBe("—");
    },
  );
});

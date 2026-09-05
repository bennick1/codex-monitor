import { describe, expect, it } from "vitest";
import { formatTokenCount } from "./tokenFormat";

describe("exact decimal token formatting", () => {
  it.each([
    ["0", "0"], ["000", "0"], [null, "—"], [undefined, "—"], ["", "—"], ["-1", "—"], ["NaN", "—"],
    ["999", "999"], ["1000", "1K"], ["1049", "1K"], ["1050", "1.1K"], ["999949", "999.9K"],
    ["999950", "1M"], ["1000000", "1M"], ["999950000", "1B"], ["1000000000", "1B"],
    ["9007199254740993", "9Q"], ["9223372036854775807", "9.2E"],
    ["1049999999999999999", "1E"], ["1050000000000000000", "1.1E"],
  ])("formats %s as %s", (input, expected) => expect(formatTokenCount(input)).toBe(expected));
});

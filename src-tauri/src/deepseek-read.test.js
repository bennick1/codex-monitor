import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const script = readFileSync(new URL("./deepseek-read.js", import.meta.url), "utf8");
async function read(token, origin = "https://platform.deepseek.com", status = 200) {
  const page = {};
  const fetch = vi.fn(async () => ({ ok: status === 200, status, text: async () => '{"tokens":9007199254740993}' }));
  await runInNewContext(script, { window: page, location: { origin }, localStorage: { getItem: () => token }, fetch, Date, URLSearchParams, AbortController, setTimeout, clearTimeout });
  return { result: page.__codexMonitorDeepSeek, fetch };
}

it("makes no requests without a session or outside the approved origin", async () => {
  const loggedOut = await read(null);
  expect(loggedOut.result.status).toBe("signed_out"); expect(loggedOut.fetch).not.toHaveBeenCalled();
  const foreign = await read("synthetic-secret", "https://example.invalid");
  expect(foreign.result.status).toBe("unavailable"); expect(foreign.fetch).not.toHaveBeenCalled();
});

it("keeps session credentials inside same-origin requests and preserves response integers as text", async () => {
  const { result, fetch } = await read('{"value":"synthetic-secret"}');
  expect(result.status).toBe("ok"); expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  expect(result.summary).toBe('{"tokens":9007199254740993}');
  const requests = fetch.mock.calls;
  expect(requests).toHaveLength(3);
  for (const [path, options] of requests) {
    expect(path).toMatch(/^\/api\/v0\//);
    expect(options.redirect).toBe("error");
    expect(options.headers).toEqual(expect.objectContaining({ Authorization: "Bearer synthetic-secret" }));
  }
  const start = new Date(Number(result.start) * 1000), end = new Date(Number(result.end) * 1000);
  expect(start.getHours()).toBe(0); expect(end.getHours()).toBe(0);
  const expectedEnd = new Date(start); expectedEnd.setDate(expectedEnd.getDate() + 30);
  expect(end.getTime()).toBe(expectedEnd.getTime());
});

it("reports an expired session and does not retain previous data", async () => {
  const { result } = await read("synthetic-secret", undefined, 401);
  expect(result).toEqual({ status: "signed_out" });
});

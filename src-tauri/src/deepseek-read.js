(async () => {
  // Runs only in this application's isolated DeepSeek webview. The token never
  // leaves the page; only usage responses are returned to the native parser.
  window.__codexMonitorDeepSeek = null;
  try {
    if (location.origin !== "https://platform.deepseek.com") throw new Error();
    const extract = value => {
      if (typeof value === "string") return value.trim();
      if (!value || typeof value !== "object") return null;
      for (const key of ["value", "token", "access_token", "accessToken"]) {
        const token = extract(value[key]); if (token) return token;
      }
      return null;
    };
    const raw = localStorage.getItem("userToken");
    let token;
    try { token = extract(JSON.parse(raw)); } catch { token = raw?.trim(); }
    if (!token) { window.__codexMonitorDeepSeek = { status: "signed_out" }; return; }
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tz = -now.getTimezoneOffset() * 60;
    const query = new URLSearchParams({ start: String(start.getTime() / 1000), end: String(end.getTime() / 1000), tz: String(tz) });
    const headers = { Accept: "application/json", "x-client-platform": "web", Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` };
    const get = async path => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(path, { credentials: "include", headers, redirect: "error", signal: controller.signal });
        if (response.status === 401 || response.status === 403) throw new Error("signed_out");
        if (!response.ok) throw new Error();
        const text = await response.text();
        if (text.length > 1024 * 1024) throw new Error();
        return text;
      } finally { clearTimeout(timer); }
    };
    const [summary, amount, cost] = await Promise.all([
      get("/api/v0/users/get_user_summary"),
      get(`/api/v0/usage/by_api_key/amount?${query}`),
      get(`/api/v0/usage/by_api_key/cost?${query}`),
    ]);
    window.__codexMonitorDeepSeek = { status: "ok", summary, amount, cost, start: start.getTime() / 1000, end: end.getTime() / 1000, timeZoneSeconds: tz };
  } catch (error) {
    window.__codexMonitorDeepSeek = { status: error?.message === "signed_out" ? "signed_out" : "unavailable" };
  }
})();

# Privacy

Codex Monitor is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- 应用仅向所需 ChatGPT 额度及账户统计接口发送已有 Codex access token。
- The app may read the account identifier from the login file or token payload only to set the request header expected by the quota service.
- Token accounting continues to read JSONL files in `sessions` and `archived_sessions` under the effective `CODEX_HOME`, defaulting to the user's `.codex` directory. It extracts structured usage counters and minimal identity/time evidence and skips conversation message bodies. Links escaping the allowed source directories are rejected.
- Fast attribution can additionally read request metadata from the single local diagnostic source `CODEX_HOME/logs_2.sqlite`, only when its expected `logs` table structure is recognized. Bounded pages traverse log IDs, but only exact `feedback_tags` records with bounded field lengths are returned for parsing. The collector requires matching thread/Turn identities in the structured request prefix and an exact `service_tier` value. It does not read arbitrary Codex databases or collect all diagnostic log bodies.
- This supplemental source is opened read-only, is never created if absent, and is read with its current WAL. The app does not change source permissions, write data or DDL, checkpoint, vacuum, change its journal mode, enable global diagnostics, or stop Codex. Missing, locked, corrupt, or incompatible diagnostic sources do not block Token accounting. The independent collector does not read `auth.json`, other tools, other accounts, or remote sources.

## What It Stores

Codex Monitor stores widget preferences in its own application config directory:

- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- language, Light / Dark / Follow system appearance, selected built-in skin, and persistent expansion
- 悬浮窗整体透明度、展示模式、侧边位置/大小/底色不透明度/毛玻璃效果、服务显示开关、是否启用 DeepSeek 网站登录及自动检查更新开关

历史 `selectedSkin` 值（`default`、`blur`、`computer`）继续保留，新增 `mecha-light` 使用同一普通本地偏好。 Removed supporter-license, unlock, and reminder fields in older settings are ignored and omitted from subsequent preference saves. Skin selection and bundled skin assets add no network requests. The app no longer reads hardware identifiers or generates device request codes. Existing position settings and the Token Statistics database are preserved.

Token Statistics stores `token-statistics.sqlite3` and its SQLite WAL/SHM files in the app's local data directory. It retains only token counters, UTC timestamps and time quality, hashed thread/response/source identities, source-relative paths and file fingerprints, checkpoints, unresolved candidates, and reconciliation links. Absolute source paths exist only in memory; source-relative paths are not returned to the frontend. The supplemental `fast_request_evidence` table stores only hashed root/thread/Turn keys and compact requested-tier flags; existing core tables and accounting rules remain compatible with application schema version 4. Hashes support indexing and deduplication; they are not encryption.

Confirmed statistics and the minimal evidence needed to prevent recounting remain after source sessions are archived or deleted. Deleting source logs therefore does not delete previously collected statistics. Source roots remain separate when `CODEX_HOME` changes. The database is historical state, not a disposable cache; losing it without a consistent backup can lose statistics from already deleted sources. Unsupported versions or corruption cause an explicit error and preserve the existing database.

It does not copy or persist Codex access tokens, credentials, account IDs, raw quota responses, prompts, answers, reasoning text, code, tool contents, conversation titles, original JSONL lines, raw diagnostic records, or `tags_json`. All Token Statistics processing and storage stays on the current machine, protected by the current user's filesystem permissions; none of these statistics are uploaded.

## What It Sends

Codex 额度与账户统计请求使用以下 HTTPS 接口：

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
- `https://chatgpt.com/backend-api/wham/profiles/me`：侧边栏的账户统计，只在内存中保存所需字段；不写入本机 Token 数据库。

### 可选的 DeepSeek 登录

用户选择登录后，应用才启用 `https://platform.deepseek.com/usage` 的独立 WebView。macOS 14 及以上使用独立网站数据容器，旧版 macOS 使用临时会话；Windows 使用应用专属网站数据目录。该容器可能保留网站 Cookie 和 localStorage，以恢复登录。它与 Codex 登录文件、本机统计数据库及普通浏览器隔离；“退出 DeepSeek 登录”会清理容器中的网站数据。

应用在此网站页面内读取其已有登录状态，向同源的 `/api/v0/users/get_user_summary`、`/api/v0/usage/by_api_key/amount`、`/api/v0/usage/by_api_key/cost` 发送请求。认证值不返回应用前端、不另写文件、不记日志。Rust 仅在内存中解析统计响应，返回余额、累计费用、区间 Token、请求数、API 密钥数量和每日汇总；不返回密钥名称或标识。远程页面不获得本地 Tauri 命令权限。

DeepSeek 网站本身的资源请求及登录处理由该服务控制，适用其网站隐私政策。应用不上传本机 Codex 会话或 Token 数据。显示的忙闲计价时段只是提示，实际费用始终使用平台响应，不能据此推算账单。

macOS 侧边栏通过 AppKit 鼠标按下事件判断设置外部点击；鼠标移动及左键拖动时，在内存中判断指针是否位于侧边窗口内，用于未激活应用时的悬停展开与离开收起。窗口内移动时，前端接收相对于侧边窗口的坐标、窗口尺寸及移动序号，用于识别额度圆环与齿轮，并过滤缩放产生的过时事件；窗口外仅发送离开状态，不发送窗口外位置或全局坐标。监听不包含键盘事件，不记录、保存或上传鼠标轨迹及点击内容，应用退出时移除监听。

在线更新检查访问固定的 `https://github.com/bennick1/codex-monitor/releases/latest/download/latest.json`；用户可关闭后台检查。下载和安装须用户操作，更新包使用嵌入公钥验签。GitHub/CDN 会收到普通网络请求信息（例如 IP 与请求时间），不会收到 Codex 凭据、会话或本地统计。未配置公钥时可打开 `https://github.com/bennick1/codex-monitor/releases` 手动下载。独立 QA 构建仅允许本机 HTTP 测试端点，正式构建拒绝 QA 配置。

应用本身不包含遥测、分析、崩溃上报或第三方追踪；可选网站页面的行为按上节说明。

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths, raw diagnostic records, `tags_json`, or unhashed thread/Turn IDs.

## Accuracy Boundary

Codex Monitor displays quota windows returned by the Codex quota service. It does not estimate quota from local token usage and does not fabricate values when the response shape is unknown. Local Token Statistics is a separate measurement of recognized, confirmed and deduplicated records. Incomplete history, uncertain timestamps and ambiguous format transitions are reported explicitly. It cannot recover logs deleted before collection or represent cloud, cross-device or account-wide usage.

Fast indicators describe local selection/request evidence. Exact `priority` or `fast` means a Fast request; exact `default` means an ordinary request. `feature.fast_mode=true` alone is not tier evidence. Conflicting requests or conflicting selection evidence remain Unknown. A request record does not prove the server's execution tier or the tier of every request in that Turn. Model, effort, Token counts, duration, and quota changes are not used to infer Fast.

Historical request metadata is replayed in bounded pages during normal refreshes, while new records also receive a share of each refresh. A Turn not yet reached by replay is not necessarily unrecoverable. If diagnostic logs have already been cleaned and no other trustworthy evidence exists, historical Turns can remain Unknown. Collected request evidence survives source cleanup and normal app restarts; source roots, cursors, and persisted evidence remain separate when `CODEX_HOME` changes. All processing is local; these records and statistics are not uploaded.

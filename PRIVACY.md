# Privacy

Codex Monitor is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
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

The valid historical `selectedSkin` values (`default`, `blur`, and `computer`) are retained as a normal local preference. Removed supporter-license, unlock, and reminder fields in older settings are ignored and omitted from subsequent preference saves. Skin selection and bundled skin assets add no network requests. The app no longer reads hardware identifiers or generates device request codes. Existing position settings and the Token Statistics database are preserved.

Token Statistics stores `token-statistics.sqlite3` and its SQLite WAL/SHM files in the app's local data directory. It retains only token counters, UTC timestamps and time quality, hashed thread/response/source identities, source-relative paths and file fingerprints, checkpoints, unresolved candidates, and reconciliation links. Absolute source paths exist only in memory; source-relative paths are not returned to the frontend. The supplemental `fast_request_evidence` table stores only hashed root/thread/Turn keys and compact requested-tier flags; existing core tables and accounting rules remain compatible with application schema version 4. Hashes support indexing and deduplication; they are not encryption.

Confirmed statistics and the minimal evidence needed to prevent recounting remain after source sessions are archived or deleted. Deleting source logs therefore does not delete previously collected statistics. Source roots remain separate when `CODEX_HOME` changes. The database is historical state, not a disposable cache; losing it without a consistent backup can lose statistics from already deleted sources. Unsupported versions or corruption cause an explicit error and preserve the existing database.

It does not copy or persist Codex access tokens, credentials, account IDs, raw quota responses, prompts, answers, reasoning text, code, tool contents, conversation titles, original JSONL lines, raw diagnostic records, or `tags_json`. All Token Statistics processing and storage stays on the current machine, protected by the current user's filesystem permissions; none of these statistics are uploaded.

## What It Sends

Quota requests from the local desktop process use these HTTPS endpoints:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

V1 has no runtime updater and does not query, download, or install application updates. Choosing the tray's manual download entry opens `https://github.com/bennick1/codex-monitor/releases` in the browser. Codex credentials and local statistics are not sent to GitHub.

No telemetry, analytics, crash reporting, or third-party tracking is included.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths, raw diagnostic records, `tags_json`, or unhashed thread/Turn IDs.

## Accuracy Boundary

Codex Monitor displays quota windows returned by the Codex quota service. It does not estimate quota from local token usage and does not fabricate values when the response shape is unknown. Local Token Statistics is a separate measurement of recognized, confirmed and deduplicated records. Incomplete history, uncertain timestamps and ambiguous format transitions are reported explicitly. It cannot recover logs deleted before collection or represent cloud, cross-device or account-wide usage.

Fast indicators describe local selection/request evidence. Exact `priority` or `fast` means a Fast request; exact `default` means an ordinary request. `feature.fast_mode=true` alone is not tier evidence. Conflicting requests or conflicting selection evidence remain Unknown. A request record does not prove the server's execution tier or the tier of every request in that Turn. Model, effort, Token counts, duration, and quota changes are not used to infer Fast.

Historical request metadata is replayed in bounded pages during normal refreshes, while new records also receive a share of each refresh. A Turn not yet reached by replay is not necessarily unrecoverable. If diagnostic logs have already been cleaned and no other trustworthy evidence exists, historical Turns can remain Unknown. Collected request evidence survives source cleanup and normal app restarts; source roots, cursors, and persisted evidence remain separate when `CODEX_HOME` changes. All processing is local; these records and statistics are not uploaded.

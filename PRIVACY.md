# Privacy

Quota Float is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
- The app may read the account identifier from the login file or token payload only to set the request header expected by the quota service.
- The independent Token Statistics collector reads only JSONL files in `sessions` and `archived_sessions` under the effective `CODEX_HOME`, defaulting to the user's `.codex` directory. It extracts structured usage counters and minimal identity/time evidence, skips message bodies, and does not read `auth.json`, Codex databases, other tools, other accounts or remote sources. Links escaping the allowed source directories are rejected.

## What It Stores

Quota Float stores widget preferences in its own application config directory:

- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- language, Light / Dark / Follow system appearance, and persistent expansion

Removed supporter-license, skin and reminder fields in older settings are ignored and omitted from subsequent preference saves. The app no longer reads hardware identifiers or generates device request codes. Existing position settings and the Token Statistics database are preserved.

Token Statistics stores `token-statistics.sqlite3` and its SQLite WAL/SHM files in the app's local data directory. It retains only token counters, UTC timestamps and time quality, hashed thread/response/source identities, source-relative paths and file fingerprints, checkpoints, unresolved candidates, and reconciliation links. Absolute source paths exist only in memory; source-relative paths are not returned to the frontend. Hashes support indexing and deduplication; they are not encryption.

Confirmed statistics and the minimal evidence needed to prevent recounting remain after source sessions are archived or deleted. Deleting source logs therefore does not delete previously collected statistics. Source roots remain separate when `CODEX_HOME` changes. The database is historical state, not a disposable cache; losing it without a consistent backup can lose statistics from already deleted sources. Unsupported versions or corruption cause an explicit error and preserve the existing database.

It does not copy or persist Codex access tokens, credentials, account IDs, raw quota responses, prompts, answers, reasoning text, code, tool contents, conversation titles, or original JSONL lines. All Token Statistics processing and storage stays on the current machine, protected by the current user's filesystem permissions; none of these statistics are uploaded.

## What It Sends

The app only calls these quota-related HTTPS endpoints from the local desktop process:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

No telemetry, analytics, crash reporting, or third-party tracking is included.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths.

## Accuracy Boundary

Quota Float displays quota windows returned by the Codex quota service. It does not estimate quota from local token usage and does not fabricate values when the response shape is unknown. Local Token Statistics is a separate measurement of recognized, confirmed and deduplicated records. Incomplete history, uncertain timestamps and ambiguous format transitions are reported explicitly. It cannot recover logs deleted before collection or represent cloud, cross-device or account-wide usage.

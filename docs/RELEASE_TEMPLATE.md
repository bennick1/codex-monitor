# Codex Monitor v1.0.0

A lightweight, local-first floating desktop monitor for Codex quota, reset times, and token usage on this machine.

## Features

- Codex 5-hour and weekly quota with reset times and explicit unavailable/stale states.
- Today, week, month, and locally collected total Token Statistics, with incremental scanning and SQLite persistence.
- Compact `万` / `亿` summaries and exact comma-separated details.
- Windows/macOS floating widget with tray controls and Chinese/English labels.

## Downloads

- macOS: `Codex-Monitor-1.0.0.dmg` — Universal binary; **Unsigned / Not Notarized**.
- Windows: `Codex-Monitor-1.0.0.exe` — x64 NSIS installer; unsigned publisher.
- `SHA256SUMS` — must cover both final installers.

Open the macOS DMG and drag Codex Monitor to Applications. On Windows, run the NSIS installer as a normal user and launch it from the Start menu. Sign in to Codex on the same machine to read quota.

The macOS package is not Apple verified, notarized, or signed with an Apple Developer ID, so Gatekeeper may show a warning. Windows may show an unknown-publisher or SmartScreen warning. Verify `SHA256SUMS` before installation.

## Privacy

Statistics remain local. No prompts, chats, source code, or account credentials are retained by the monitor. The quota reader uses the existing local login credential only for ChatGPT quota requests; the separate token collector stores minimal usage evidence. No telemetry or cloud sync. See [Privacy](https://github.com/bennick1/codex-monitor/blob/main/PRIVACY.md).

## Upgrade and limitations

- The legacy application identifier is retained to preserve local settings and historical statistics. Quit the old app before installing, keep a consistent data backup, and verify startup entries after renaming.
- Local statistics do not represent account-wide or cross-device usage; missing history is marked.
- Quota service response changes may require a compatibility fix.
- No Pet, QQ Skin, AI chat, other AI platforms, cloud synchronization, or user system.
- Updates are manual. The app does not query, download, or install updates; download newer versions only from [Codex Monitor Releases](https://github.com/bennick1/codex-monitor/releases).

## Validation

The [V1.0.0 validation report](https://github.com/bennick1/codex-monitor/blob/main/docs/v1.0.0-release-validation-report.md) is Ready. macOS and Windows human acceptance passed; detailed Windows environment records were not supplied and are not inferred. Final unsigned candidates were built from commit `a4d3b3119e4411c52d4d7c51d7700bcf5ca0adc0` in [Release Preparation #33982068031](https://github.com/bennick1/codex-monitor/actions/runs/33982068031). The workflow passed tests, audit, updater-policy checks, macOS bundle verification, and Windows NSIS install/start/uninstall smoke. Verify the attached `SHA256SUMS` before installation.

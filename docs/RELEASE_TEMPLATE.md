# Codex Monitor v1.1.0

A lightweight, local-first floating desktop monitor for Codex quota, reset times, and token usage on this machine.

## Features

- **Per-model Token Statistics:** view Today, Quota Period, 7 Days, 30 Days, and Total with each model's name, Token count, and share. By Model opens on Quota Period; Overview keeps Today, This Week, This Month, and Total.
- **Quota Period and rolling periods:** Quota Period aligns with the valid Codex weekly quota window and has no natural-week fallback. 7 Days and 30 Days are exact rolling 7×24-hour and 30×24-hour windows, not the natural week or current month.
- **History:** existing local Codex rollouts can supply model attribution for historical Token records. History that cannot be reliably attributed appears as **Unidentified**; complete attribution is not guaranteed.
- Codex 5-hour and weekly quota, reset times, explicit unavailable/stale states, incremental local Token collection, and exact Token details.
- Windows/macOS floating widget with tray controls and Chinese/English labels.

## Downloads

- macOS: `Codex-Monitor-1.1.0.dmg` — Universal (`arm64` + `x86_64`); **Unsigned / Not Notarized**.
- Windows: `Codex-Monitor-1.1.0.exe` — x64 NSIS installer; **unsigned publisher**.
- `SHA256SUMS` — covers both final installers.

Open the macOS DMG and drag Codex Monitor to Applications. Run the Windows NSIS installer as a normal user. Quit the previous app before installing. Verify `SHA256SUMS` before installation.

The macOS package is not Apple verified, notarized, or signed with an Apple Developer ID; Gatekeeper may warn. Windows may show an unknown-publisher or SmartScreen warning. An ad-hoc linker signature is not a Developer ID signature.

## Upgrade and downgrade limitation

The application identifier remains `app.quotafloat.desktop` to retain local settings and statistics. An existing v1.0.0 installation can be upgraded without first uninstalling; preserve a consistent backup and check settings, history, and restart behavior during final package acceptance.

**v1.1.0 upgrades the Token Statistics SQLite database to schema 2.** Running v1.0.0 after this upgrade makes its Token Statistics unavailable because it cannot read schema 2. The previously verified refusal path does not damage the database, and v1.1.0 can reopen the original data. This is not supported downgrade compatibility with v1.0.0.

## Privacy and known limitations

- Token Statistics are collected on this machine, not official account-wide or cross-device totals.
- Historical model attribution may contain Unidentified records. Initial model backfill and restart integrity checks can take time; missing sources may be retried on a later startup.
- SQLite schema 2 cannot be read by v1.0.0 Token Statistics.
- macOS is unsigned / not notarized; Windows has an unsigned publisher.
- Updates are manual through [Codex Monitor Releases](https://github.com/bennick1/codex-monitor/releases). There is no Tauri updater runtime or automatic download/install.
- No automatic quota-to-Token capacity prediction is provided.
- No telemetry or cloud synchronization. See [Privacy](https://github.com/bennick1/codex-monitor/blob/main/PRIVACY.md).

## Validation status

This is release-preparation copy, not an announcement of publication. See the [v1.1.0 validation report](v1.1.0-release-validation-report.md) for the build source, Actions run, checksums, automated evidence, and separate macOS/Windows human acceptance states. CI success does not establish real-machine acceptance. A Tag or any GitHub Release requires the user's explicit “可以发布”.

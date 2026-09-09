# Codex Monitor v1.1.0 GitHub 发布检查

当前事实源为 [v1.1.0 发布验证报告](v1.1.0-release-validation-report.md) 和 [发布准备指南](RELEASE.md)。不沿用 v1.0.0 已完成的勾选状态。

- [ ] Release Source SHA locked：package / Cargo / Tauri 均为 1.1.0，identifier 保持 app.quotafloat.desktop。
- [ ] Release Build Source 已普通 fast-forward 推送 origin/main，workflow head_sha 与其完全一致。
- [ ] Release Source 仅包含已授权 Vitest 4.1.11 安全修复、release workflow、artifact script、release docs 和必要 README 改动；没有生产逻辑或无关依赖变化。
- [ ] 双平台 npm ci、updater policy、frontend tests、build、两项 audit、Rust fmt/test/clippy 全部通过；两项 audit 均为 0 vulnerabilities。
- [ ] V1 → V1.1 migration verified：schema 1 → 2；历史 accounting/total 保留、model backfill、restart、incremental、failure rollback 测试保留且通过。
- [ ] macOS candidate verified：Actions Universal DMG、metadata、arm64 + x86_64、hdiutil 与实际签名状态已记录。
- [ ] Windows candidate verified：Actions x64 NSIS、普通用户 silent install/start/uninstall CI smoke 通过。
- [ ] Windows real-machine acceptance：由用户明确提供通过结果。
- [ ] macOS final candidate acceptance：Actions DMG final package smoke 由用户明确确认。
- [ ] DMG / EXE SHA256 verified：本地重算与对应 Actions 内部 SHA 一致，SHA256SUMS 校验成功。
- [ ] Release Notes approved：已披露 unsigned/not notarized、Unidentified、本机统计、schema 2 downgrade limitation 和手动更新。
- [ ] 候选文件与私有运行材料未进入 Git；无 SQLite/WAL/SHM、真实用量截图、凭据或 runtime logs。
- [ ] 报告区分 Release Build Source SHA 与 Latest Documentation SHA，未来 Tag 只指向实际构建源。
- [ ] user explicitly approved release：用户明确“可以发布”。

Release Preparation 只生成 Actions artifacts，不创建 Tag、GitHub Release、Draft Release 或 Pre-release。最后一项在本轮必须保持未勾选。Windows runner 不等于 Windows 人工实机验收；候选生成后状态最多为 Awaiting Human Acceptance / Candidate Ready for Windows Human Acceptance。

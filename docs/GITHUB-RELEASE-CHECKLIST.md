# Codex Monitor GitHub 发布检查

以 [V1.0.0 验收报告](v1.0.0-release-validation-report.md) 和 [发布准备指南](RELEASE.md) 为当前事实源。历史 v0.x 文档不代表 V1 验收结果。

- [ ] 分发目标为 `bennick1/codex-monitor`，版本一致为 `1.0.0`。
- [x] V1 手动更新策略已经确认并由静态门槛验证，主运行时不会查询或安装上游产品。
- [ ] 固定构建 commit SHA、时间、系统/架构、Node/Rust 版本及源码清单。
- [x] macOS 安装、启动、核心功能、Quota、Token、悬浮窗及实际使用由用户确认通过；自动化无法独立证明的全屏/Space 项按人工证据记录。
- [x] Windows 实机人工验收由用户确认通过；详细环境和逐项记录未进入仓库，不补造字段。
- [x] 签名/Gatekeeper/SmartScreen 边界如实记录为 Unsigned / Not Notarized，并由用户接受为 V1 发布限制。
- [ ] 两个平台制品与最终源码一致，`SHA256SUMS` 覆盖最终文件并复核成功。
- [ ] Git 拟提交文件没有 SQLite/WAL/SHM、`.codex`、`auth.json`、凭据、缓存、个人截图或打包文件。
- [ ] Release 文案仅使用合成/脱敏截图；名称为 `Codex Monitor v1.0.0`。
- [ ] 报告明确为 `Ready for v1.0.0 Release`。
- [ ] 人工明确确认创建 Release 后，才创建/推送 `v1.0.0` 并上传附件。

准备 workflow 只生成 Actions artifacts，不能替代真实机器验收，也不会创建草稿或公开 Release。不得用 `git add .` 混入本机资料；审核后按明确文件清单提交。

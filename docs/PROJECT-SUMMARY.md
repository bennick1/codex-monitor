# Codex Monitor 项目简介

Codex Monitor 是一个轻量、本地优先的 Codex 桌面资源监控工具：查看剩余额度、额度恢复时间和本机已采集的 Token 用量。V1.0.0 的最终发布准备和结论以 [验收报告](v1.0.0-release-validation-report.md) 为准。

## 功能与技术

- React / TypeScript / Tauri 2 / Rust，共用 Windows/macOS 界面。
- 悬浮球、展开卡片、托盘、置顶和中英文/明暗主题。
- quota 通过现有 Codex 登录态只读获取；不以 Token 数估计 quota。
- 独立 Token Collector 增量读取本地 sessions/archived_sessions，以 SQLite 保存最小统计证据，展示今日、本周、本月和本机总计。
- `CODEX_HOME` 或用户 `.codex` 为输入；统计库和偏好保留在本机，不上传。

## 当前边界

名称与版本已统一为 Codex Monitor 1.0.0。为保留已有数据，暂保留 `app.quotafloat.desktop` 和内部 `quota_float_lib`，理由及全部旧引用见 [名称迁移清单](v1.0.0-name-migration-inventory.md)。历史维护者签发工具和报告保留来源信息，不随主应用分发。

没有 Pet、QQ Skin、AI 聊天、多模型统计、云同步或用户系统。不改变 Collector、SQLite 模型、统计口径、quota 请求、时间规则与悬浮窗核心交互。

V1 正式采用手动 GitHub Release 更新：主运行时不注册 updater，不查询、下载或安装上游版本；托盘入口只打开本项目 Releases 页面。

## 入口

- 用户安装和使用：[README](../README.md)
- 隐私和网络行为：[Privacy](../PRIVACY.md)
- 双平台验收与最终制品结果：[V1.0.0 报告](v1.0.0-release-validation-report.md)
- 制品命名、SHA256 和人工发布门槛：[发布准备](RELEASE.md)

只生成安装包不能视为正式发布。两平台真实机器验收及阻塞项完成，用户确认后才创建 Release。

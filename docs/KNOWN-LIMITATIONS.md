# Codex Monitor 已知限制

V1.0.0 的发布结论及实机证据见 [发布验收报告](v1.0.0-release-validation-report.md)。

- Codex 数据来自非公开只读接口，字段或认证方式可能变化。
- V1.0.0 按 **Unsigned / Not Notarized** 发布；Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。它不是 Apple verified、notarized 或 Developer ID signed。
- Universal 构建只能证明包含 Apple Silicon 与 Intel 架构；当前用户人工使用验收来自 Apple Silicon Mac，不代表 Intel 实机验收。
- 只支持 Codex；没有其他 AI 平台、Pet、QQ Skin、AI 聊天、云同步或用户系统。
- 重置机会只读取数量和到期时间，不能在应用内兑换。
- 真实额度准确性依赖 Codex 后端返回的窗口数据；应用不会根据本地 token 消耗自行估算额度。
- CSS 毛玻璃效果在 Windows WebView2 中对桌面背景的支持有限；当前设计优先保证透明圆角悬浮球的一致外观。
- 应用更新采用手动 GitHub Release 下载；没有应用内自动检查、下载或安装更新。

# Codex Monitor 发布准备

V1.0.0 目标：`Codex-Monitor-1.0.0.dmg`、`Codex-Monitor-1.0.0.exe`、`SHA256SUMS`。最终结论以 [验收报告](v1.0.0-release-validation-report.md) 为准。

## 构建与制品

macOS 在 Mac 上构建，Windows 在 Windows MSVC 环境构建。统一 Node 22、Rust stable，使用已提交的 npm/Cargo lockfile；记录实际版本，不能只写 stable。本机 arm64 包不等于 Universal 包或 Intel 验收。

```sh
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run check:updater-policy
npm run tauri -- build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
node scripts/prepare-release-artifacts.mjs src-tauri/target/release/bundle outputs/v1.0.0
```

Windows PowerShell 把构建参数换成 `--bundles nsis`，同样使用命名脚本。Windows NSIS 配置为 `currentUser`，但 WebView2/运行时存在性和普通用户实际使用仍需实机确认。

Universal Mac 先安装 `aarch64-apple-darwin`、`x86_64-apple-darwin`，构建追加 `--target universal-apple-darwin`，命名脚本输入目录改为 `src-tauri/target/universal-apple-darwin/release/bundle`。

脚本只接受版本 1.0.0 的一个 DMG 和/或 NSIS setup.exe，拒绝同平台多个候选或覆盖不同内容。它把制品复制为目标名称，并对输出目录已有的最终安装包重算 `SHA256SUMS`。只有一个平台时这是部分清单；合并两平台后必须重新执行，不能直接拼接未知来源的校验文件。构建时间、来源 commit、源码差异和工具版本随构建证据保存到 ignored 的 outputs，不能把工作区构建写成已提交 SHA 的无差异产物。

## GitHub Actions

CI 在 push/PR 上验证前端与 Windows/macOS 编译。`release.yml` 为手动 Release Preparation，只有 read 权限，构建并上传 Actions artifacts，不创建 tag、draft Release 或 public Release。准备结果仍需下载到真实双平台验收。

V1 正式采用手动 GitHub Release 更新。运行时不注册 Tauri updater、不查询或安装上游版本；托盘下载入口只打开本项目 Releases。`npm run check:updater-policy` 在 CI 与 Release Preparation 中防止上游 updater 地址或 updater 依赖回归。

V1.0.0 的分发边界为 **Unsigned / Not Notarized**。Windows Authenticode、Apple Developer ID 和 notarization 均未配置，不能声称 Apple verified、notarized 或已解决 Gatekeeper/SmartScreen；这些状态必须在 README、报告和 Release Notes 中如实披露。

## 升级与数据

V1 保留 `app.quotafloat.desktop`，配置与统计目录继续使用它。productName、binary 改名不保证旧安装升级、开始菜单和开机启动项自动迁移；参见 [名称迁移清单](v1.0.0-name-migration-inventory.md)。退出旧实例并做一致性备份；不得覆盖活跃 SQLite 或删除旧统计，需验证重启后四周期统计和检查点仍在。

## 人工确认后的发布

只有 [发布检查清单](GITHUB-RELEASE-CHECKLIST.md) 全部满足、报告 Ready、用户明确批准后，才允许创建 `v1.0.0` Release，标题 `Codex Monitor v1.0.0`，使用 [Release 文案模板](RELEASE_TEMPLATE.md) 和两份验收过的最终安装包加完整校验文件。

本次准备不自动创建 Release，也不把本机数据库、会话、真实账号截图或安装包提交到 Git。

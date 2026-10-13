# 在线更新发布流程

本流程尚未在 GitHub 执行。本地源码版本为 1.2.1，而已发现远程最新 Release 为 1.3.1；发布门禁会阻止当前版本发布。先由维护者合并并选择高于最新正式 Release 的稳定版本，同时更新 package.json、Cargo.toml、tauri.conf.json。不得把本轮本地准备描述成已上线。

## 一次性维护者配置

在规范仓库 bennick1/codex-monitor 创建 `release` environment，只允许 main，配置 required reviewers，并禁止自我批准（组织/套餐支持时）。保护 main，禁止绕过 PR 审核。当前操作者没有 admin 权限，本轮不配置这些设置；未配置审核不能宣称发布流程已受人工门禁保护。

维护者在可信离线环境执行官方 `npx tauri signer generate` 生成正式 updater 密钥。将公钥写入 release environment variable `CODEX_MONITOR_UPDATER_PUBLIC_KEY`，私钥和密码分别写入 environment secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。密钥不得进入仓库、日志、安装包或工单；保存可恢复的离线备份。普通开发无公钥时显示“未配置”并提供 Release 下载页。正式构建缺公钥、存在 QA 标志或测试 endpoint 时失败。不要把独立 QA 密钥设为正式密钥。

Tauri updater 签名仅验证更新包来源与完整性，与 Apple Developer ID / notarization、Windows Authenticode 是不同机制。当前 OS 证书未配置；Gatekeeper/SmartScreen 与安装提示仍需真实设备验收，Release Notes 必须披露。

## 手动发布

1. 完成 [隔离升级验收](UPDATER-QA.md)，维护者确认两平台结果和版本；Windows 缺设备时保持待测。合并授权与正式发布授权分别处理。
2. 只在规范仓库 main 手动 dispatch `Signed Release`。普通 push/PR 仅执行 CI，不发布。
3. gate 固定触发时 source SHA，检查事件、仓库、main、三处版本一致、稳定 SemVer、高于最新 published Release、tag 不存在；GitHub 查询失败直接失败。所有 job checkout 同一 SHA。
4. release environment 审核后，GitHub macOS runner 构建 Universal（arm64+x86_64），Windows runner 构建 x64 NSIS。正式公钥编译进后端；安全 Node JSON 脚本生成临时 overlay 供 CLI 打包读取相同公钥和固定 endpoint，基础 tauri.conf 不持久化测试 key/endpoint。CLI 使用私钥签 updater 产物。
5. 两平台收集前读取实际 Mac Info.plist / Windows binary VERSIONINFO 与冻结正式 config，确认正式标识、名称和版本；拒绝 QA 名称/标记。验签后从实际 Mac updater tar archive 的唯一 Info.plist 和主程序读取身份与 SHA256；Windows 使用 runner 7-Zip 只向 stdout 解出 NSIS 中唯一主程序并比较其 SHA256。必须与已验证的构建二进制完全相同，不能以新版旁边的报告为旧更新包背书。解包检查不运行安装器、不将 archive 路径写入工作区。使用与官方 updater 同源的成熟 minisign-verify 库，对原始 updater 字节及 .sig 使用客户端公钥验证，错 key、错签名失败。两平台都成功才组装唯一 latest.json，复核来源 SHA、安装包、更新包、对应 .sig、公钥摘要与 SHA256。清单提供 darwin-aarch64、darwin-x86_64、windows-x86_64；Mac 两架构共享 Universal archive。
6. 再检查远程版本/tag，创建 draft 并一次上传全部资产，核对 draft 完整资产数量与大小，并重新下载逐项比较 SHA256 后才 publish/latest。任一步失败不公开半份 manifest。失败 draft 留待维护者检查；不要手动公开不完整 draft，也不要自动删已有 tag 后重跑。

源 SHA、实际 Node/npm/Rust/Tauri 版本、run URL、构建时间记录在各平台 build-environment.json；安装包和更新签名保留在同一 Release，SHA256SUMS 包括 manifest 和来源记录。SHA256 供下载校验，不替代 updater 公钥验签。

本地验证：`node --test scripts/release-updater.node-test.mjs`、`npm run check:updater-policy`。Mac CI 还构建 `verify_updater_signature` example，再设置 `CODEX_MONITOR_SIGNATURE_VERIFY_BIN` 运行同套 Node 测试：官方 CLI 对每个 tar fixture 生成有效签名，成熟库确认签名有效后，包内部旧版本、旧二进制和 QA 身份仍须被拒绝。原 `prepare-release-artifacts.mjs` 仍可准备手动分发安装包；不生成在线升级 manifest，不能把其单平台校验文件直接发布为完整在线升级集合。

## 数据和回退

正式标识保持 app.quotafloat.desktop。升级前退出旧进程并备份配置与 SQLite；不覆盖活跃数据库，不删统计数据。在线更新不会证明旧版数据库降级兼容性；遇到旧 schema 不兼容使用已记录的恢复方式。不要自动降级，也不要将 token 数量解释为额度。

## 官方依据

[Tauri v2 Updater](https://v2.tauri.app/plugin/updater/) 描述签名、静态 manifest 与更新安装行为；[GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) 描述 environment 审核和分支保护。流程尚需规范仓库维护者配置以及 Windows/macOS 实机验收。

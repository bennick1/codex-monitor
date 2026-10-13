# Windows 在线升级验收交接

- 日期：2026-10-13，Asia/Shanghai；Mac arm64 → Windows 11 x64。
- 状态：材料已准备；尚未传输、在 Windows 构建或实测。Mac 结果见 `docs/ONLINE-UPDATE-VALIDATION.md`。

## 代码与边界

仓库为 `bennick1/codex-monitor`，分支 `codex/side-dock-analysis`，基线 `a964644c84352339cd2c1e9c89a0c9e7f381ae3f`。该本地提交保存之前的侧边栏功能，未推送；当前分支没有 upstream。本次升级实现包含未提交文件，不能只检出基线。

恢复载体为源设备 `outputs/online-update-20261013/codex-monitor-online-update-source.zip`，同目录提供 `SOURCE-MANIFEST.json` 和 `SHA256SUMS.txt`。归档含当前源码、锁文件、发布工作流、QA 脚本和本说明；排除 `.git`、依赖、工具链、构建产物、数据库、测试密钥及另一个会话的 `docs/branding/icon-candidates-20261003/`、`docs/branding/sidebar/`。不要覆盖目标设备已有工作区；解压到新目录。

本轮不推送、不合并 `main`、不升级正式版本、不配置正式密钥或 GitHub 权限、不发布。正式版本仍为 1.2.1；实施前核对的远程最新版本为 1.3.1，正式发布前必须重新核对并处理版本及主分支集成。

## 目标设备第一步

取得归档和校验文件后，在 PowerShell 7 执行：

```powershell
Get-FileHash .\codex-monitor-online-update-source.zip -Algorithm SHA256
Expand-Archive .\codex-monitor-online-update-source.zip .\codex-monitor-updater-qa
Set-Location .\codex-monitor-updater-qa
$manifest = Get-Content .\SOURCE-MANIFEST.json -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
  if ((Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw "源码不一致：$($entry.path)"
  }
}
pwsh -NoProfile -File .\scripts\install-test\check-windows-build.ps1 -OutputDirectory .\outputs\preflight
```

首条命令须与旁边 `SHA256SUMS.txt` 对照；完整文件核对通过后再构建。只读预检检查 Node 22、Rust/MSVC x64 目标、MSVC C++ Build Tools、Windows SDK、WebView2、系统架构。缺项先报告，不自动安装或修改全局配置。此前该设备报告缺 Rust/MSVC/SDK，当前状态需重新核实；SSH 不影响本地构建。

## 构建与启动

环境齐备后在 x64 开发终端执行（每步确认退出码为 0）：

```powershell
npm ci
npm test
npm run build
npm run check:updater-policy
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/updater-qa.mjs prepare outputs/updater-qa
node scripts/updater-qa.mjs build outputs/updater-qa 0.0.1
node scripts/updater-qa.mjs build outputs/updater-qa 0.0.2
Get-ChildItem outputs/updater-qa/target-*/release/bundle/nsis/* | Get-FileHash -Algorithm SHA256
node scripts/updater-qa.mjs serve outputs/updater-qa normal
```

脚本生成独立测试密钥，使用 QA 标识和回环 HTTP，仅用于隔离测试。私钥不回传、不提交。记录预检报告、两个包摘要和操作结果。保持服务器终端打开；先安装 A 的 NSIS，核对独立名称、目录，不覆盖正式应用，不勾选安装器立即运行。

在另一个终端启动安装后的 A（按实际位置填写）：

```powershell
$env:CODEX_HOME = (Resolve-Path .\outputs\updater-qa\empty-codex-home).Path
$env:CODEX_MONITOR_SYNTHETIC_QUOTA = '1'
& '<独立 QA 安装目录>\codex-monitor.exe'
```

不要从开始菜单直接启动 QA：它缺少隔离环境，会拒绝运行。正式版本没有此 QA 限制。

## 必须在 Windows 完成的验收

1. 手动检查显示 B，主动下载前不取包；关闭窗口后下载继续，再打开显示进度或就绪。分别记录已知/未知总长度、重复操作与普通用户权限行为。
2. 点击安装，核对 NSIS 启动、是否提权、旧进程退出、新版本实际启动和 0.0.2；核对外观、模式、位置、自动检查开关及合成数据库。插件退出不能等同安装完成。
3. 按 `docs/UPDATER-QA.md` 切换网络、404、缺平台、错误签名、中断、同版本、旧版本场景；不得安装未通过验签的包。Mac 专用 `bad-install` 不在 Windows 运行。
4. 验证托盘/侧边栏入口、后台悬停、首次点击、DPI、重开；记录工具操作和人工结果。系统睡眠、双屏按设备条件执行，未做保持待测。
5. 发布流程的 Windows NSIS 7-Zip 内部主程序提取与身份核对也待原生验证；不得仅凭 Mac 脚本测试标为通过。

发现问题先保存脱敏步骤、包摘要和错误阶段，再局部修复、重建并在同一设备复测。结束后退出 QA 和本机服务器。只回传脱敏结果，不回传账户截图、原始接口响应或密钥。

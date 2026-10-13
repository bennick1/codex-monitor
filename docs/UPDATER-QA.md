# 本地隔离在线升级 QA

此流程只升级独立 QA 应用，当前合并后的基础版本为 1.3.1。A=0.0.1、B=0.0.2 使用独立 `app.codexmonitor.updater-test.local` 标识和 `Codex Monitor Updater QA` 名称；全部材料在 ignored outputs/updater-qa，不接触正式安装目录。测试密钥只能用于本机 QA。

## 准备与构建

使用已有 Node 22+、Rust、Tauri 工具链，先 npm ci。空 CODEX_HOME 与独立应用容器隔离真实账号和数据库；后端 QA 标志允许合成数据，禁止测试读取真实 Codex 目录。不要手动修改正式 tauri.conf 或正式版本。

```sh
node scripts/updater-qa.mjs prepare
node scripts/updater-qa.mjs build outputs/updater-qa 0.0.1
node scripts/updater-qa.mjs build outputs/updater-qa 0.0.2
node scripts/updater-qa.mjs serve outputs/updater-qa normal
```

prepare 通过官方 Tauri signer 生成仅 QA 的私钥、公钥以及两份 overlay。build 复用 target-build 编译缓存，完成后将 bundle 保存到 target-0.0.1 或 target-0.0.2（已有目录拒绝覆盖）。build 将 key 放入进程环境，正式公钥仅编译进 QA 二进制；私钥不得打印。macOS 使用 ad-hoc signing；这是本机开发测试，不是公证。服务器只绑定 127.0.0.1:18765，直到 Ctrl+C；不要开放外网。

Mac 必须执行 `node scripts/updater-qa.mjs launch outputs/updater-qa` 首次启动。脚本将 A 复制到独立可写 installed 目录，以 `detached:true`、独立文件日志和 `unref()` 启动二进制，设置空 CODEX_HOME 与 `CODEX_MONITOR_SYNTHETIC_QUOTA=1`。终端会话结束不会主动终止 QA 进程；Tauri 更新重启继承隔离环境与独立 stdio。启动 PID、二进制路径和日志路径记录在 qa-launch.json，应用日志在 qa-app.log；该 PID 是启动时 PID，更新重启后的实际 PID 须重新核对。重开已安装的 A/B 使用 `node scripts/updater-qa.mjs start outputs/updater-qa`，不会重新复制或覆盖升级后的 B。不要用 Finder 或 `open` 启动：缺少隔离环境时 QA 构建会拒绝启动。必须确认只有一个 QA 实例，重开前先退出既有实例。

Windows 在本机单独安装 A 的 QA NSIS，确认独立名称和安装路径，再通过 PowerShell `$env:CODEX_HOME` 指向空测试目录并启动 QA exe。不要将 QA exe 安装到正式路径。

## 必测结果

A 主动检查应发现 B；在明确点击下载之前不得自动下载。点击下载后真实下载且通过官方 updater 签名校验，确认重启安装，再运行检查版本应为 0.0.2，合成配置和数据库仍可读取。安装会结束进程，需记录重新启动后版本、独立容器路径及数据状态。取消确认、重复点击、离线重试和自动检查关闭也需验收。

重装 A 后逐个重启 server 场景：`missing`（404 manifest）、`bad-signature`（A 的合法签名搭配 B 原字节，官方验签失败不得安装）、`bad-download`（404 archive）、`older`、`same`、`missing-platform`；`slow` / `chunked` 可验收进度与关闭窗口后继续下载。`interrupted` 宣告完整 Content-Length 后只发送四分之一并断开，下载失败不得进入可安装状态；重启 normal 后应可重试。`bad-install` 仅 macOS 可用，以现有 QA 测试密钥签非 gzip 内容：官方验签应通过、安装解包应失败且 A 保持原版本。固定 tauri-plugin-updater 2.9.0 的源码顺序为先在临时目录读取/解包 gzip/tar，再移动当前 .app；此无效 gzip 在移动前失败。测试仍须实查错误阶段、旧 A 二进制摘要及继续运行状态，不将源码判断当作实际安装验收。每次通过真实 UI 检查错误提示与重试行为；错误签名映射脚本测试仅验证映射，密码学正确性由官方 plugin 真下载路径证明。

记录平台/架构、工具版本、A/B overlay、资产 SHA、请求场景、下载前后状态和重启后的实际版本。只有编译、静态测试不能记为实际升级通过。Mac arm64 本机测试不等于 Universal Intel 验收；Windows 未运行时写“待测”。测试后退出 QA 进程、停止本机 server，保留证据；删除测试密钥前按需要归档本机安全材料，禁止提交私钥。

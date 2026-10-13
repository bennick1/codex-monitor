# 侧边栏独立实机验收

本流程验证当前未提交源码，不提交、推送或发布 Release。所有结果按“通过／失败／待测／不适用”记录；编译与单元测试不能代替实机操作。账号、验证码、凭据、原始响应和真实账号截图不进入交付物。

## 实例与数据隔离

| 实例 | 应用标识 | 数据来源 |
| --- | --- | --- |
| 原有 Mac 合成包 | `app.codexmonitor.sidebar.validation` | 合成额度与账户统计 |
| Windows 合成包 | `app.codexmonitor.sidebar.validation.windows` | 合成额度与账户统计 |
| 真实验收包 | `app.codexmonitor.sidebar.acceptance` | 独立空会话目录；Mac 只读链接现有登录文件；DeepSeek 独立网站会话 |

配置、SQLite 和网站存储按应用标识分离。Mac 14 及以上的 DeepSeek 使用独立持久 WKWebsiteDataStore；Windows 使用该应用本地数据目录的 `deepseek-webview/`。关闭网站窗口只隐藏它；设置里的“退出 DeepSeek 登录”只清除这个实例的网站数据。

验收包使用 debug 构建。真实包启动前检查目录标记、空的 `sessions/` 和 `archived_sessions/`，拒绝直接链接真实会话目录。合成包仍要求显式合成标志。不要直接双击冷启动验收包；使用下列脚本。应用已运行时可以测试再次打开行为。

## Mac 启动及凭据失效

在仓库根目录执行；使用已准备好的项目工具链。构建不会替换原有合成 `.app`：

```sh
npm run tauri -- build --debug --bundles app --config scripts/acceptance/live.json -- --locked
node scripts/acceptance/run.mjs prepare --mode live
node scripts/acceptance/run.mjs auth --state linked
node scripts/acceptance/run.mjs start --mode live --app "$PWD/src-tauri/target/debug/bundle/macos/Codex Monitor Sidebar Acceptance.app/Contents/MacOS/codex-monitor"
```

默认验收目录 `/private/tmp/codex-monitor-live-acceptance-home`；`--home` 可指定另一独立绝对路径。`auth --state linked` 从调用终端的 `CODEX_HOME/auth.json` 或 `~/.codex/auth.json` 创建符号链接，也可用 `--source /绝对路径/auth.json` 明确来源。脚本不复制、不改写来源文件；目录应仅用于验收。

应用运行时依次执行以下命令，每次在设置中“立即刷新”并查看 Codex 详情：

```sh
node scripts/acceptance/run.mjs auth --state missing
node scripts/acceptance/run.mjs auth --state invalid
node scripts/acceptance/run.mjs auth --state linked
```

缺失或无效状态应明确提示不可用或旧数据，恢复链接并刷新后应重新读到数据。脚本先解除链接才写无效夹具，拒绝覆盖未知普通文件。结束时务必恢复 `linked`。这只验证主动制造的失效，不代表自然过期或服务器撤销实测通过。

## 真实账号检查顺序

1. Codex：核对周额度使用“剩余”，重置时刻按本地时间显示；账户统计与本机统计分开。官网有对应字段时同口径比对；其余仅记录接口是否读取成功。无当日桶显示“待出”，未知值显示 `—`。
2. DeepSeek：在验收实例登录窗口手动完成登录和验证码。将平台日期范围设为包含今天的近 30 个自然日、相同时区，逐项对比余额、累计费用、请求数、Token 和每日图表。资金圆环为 `余额 / (余额 + 累计费用)`，不以请求数推算金额。不调用推理接口制造用量。
3. 记录模式、左右侧、外观、透明度；菜单退出应用，确认进程结束，再用脚本冷启动，共三次。每次检查设置恢复、DeepSeek 免重新登录、刷新成功。此处不是操作系统重启。
4. DeepSeek 设置退出后应显示未登录；重新登录后恢复读取，并核对其他应用会话未受影响。主动退出不代表自然过期。
5. 用户短暂断网，手动刷新，检查失败或旧数据标识和操作入口；恢复网络再刷新。网络由用户操作，避免中断远程协作时失去恢复入口。

## 菜单栏与硬件

先退出另一个验收实例，避免将它的图标误计入结果。菜单栏由用户目视检查：悬浮模式恰有一个图标、侧边模式无图标，往返三次及冷启动后仍正确，齿轮或拉手始终可操作。

用户准备好硬件后依次检查：第二显示器左右排列、主屏切换、不同缩放；拔除组件所在屏幕后迁回可用主屏，重连后保持当前可操作屏幕；进入/退出全屏和切换 Space；从拉手、详情、菜单三个状态分别睡眠再唤醒。每次检查窗口在可见工作区、详情向内、悬停命中、键盘焦点、数据刷新与入口。结束后恢复原显示设置，不新增跟随鼠标跨屏。

## Windows 11 x64 本机构建

将交付的源码 ZIP 解压到普通用户可写目录。快照包含锁文件及未提交改动，`SOURCE-MANIFEST.json` 保存逐文件摘要。请在原生 x64 PowerShell 中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\acceptance\build-windows.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\acceptance\build-windows.ps1 -Build
```

第一条只检查 Windows 11 x64、Node.js 22、Rust MSVC 目标、MSVC Build Tools、Windows SDK 和 WebView2，缺项退出，不自动安装或改全局环境。WebView2 检测采用 [Microsoft 官方注册表检测方式](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。第二条校验源码、安装锁定的项目依赖、运行检查、构建两种独立 NSIS debug 包；版本读取当前配置，不使用旧发布工作流。输出位于 `outputs/windows-acceptance/日期时间/`，含环境记录和 SHA-256。首次依赖下载需要联网。

分别用普通用户安装 `synthetic/` 和 `live/` 下的 NSIS 包，取消安装末尾“立即运行”。找到各自安装目录中的 `codex-monitor.exe` 后启动，以下路径需替换为实际安装路径：

```powershell
node scripts/acceptance/run.mjs prepare --mode synthetic
node scripts/acceptance/run.mjs start --mode synthetic --app "C:\实际合成实例安装目录\codex-monitor.exe"
# 完全退出合成实例后：
node scripts/acceptance/run.mjs prepare --mode live
node scripts/acceptance/run.mjs start --mode live --app "C:\实际真实实例安装目录\codex-monitor.exe"
```

Windows 真实实例默认不接入 Codex 凭据，只验收独立 WebView2 的 DeepSeek 登录、退出恢复和三次冷启动。不要复制凭据到源码包，也不要对生产实例使用此启动器。Windows 合成实例检查普通用户安装、托盘及溢出区、三次模式往返、拉手/详情/齿轮悬停、外部点击、键盘保持、重开和主题切换；双屏、DPI、睡眠按设备条件检查。Mac 或 CI 结果不能填作 Windows 实测。

## 毛玻璃追加验收（2026-10-03）

新配置 `sidebarGlassEnabled` 缺失时默认开启；在设置中关闭后恢复原半透明底色。原有不透明度数值保留：100% 为实色，验收模糊时可临时设为70%，结束后恢复原值。小拉手始终使用独立实色背景。

Mac 使用局部 `NSVisualEffectView`；Windows 11 使用局部 HostBackdrop 合成层。Windows 构建步骤仍使用上方源码快照流程；Windows API 的目标编译检查不代表完整安装包构建或设备运行通过。

1. 在纯色、文字密集及合成色块背景上，切换毛玻璃开／关，检查栏体、两个详情、设置和展开按钮内的背景模糊；组件外空白应保持清晰，不出现整块矩形材质。
2. 检查浅色、深色和跟随系统；开启系统减少透明度／高对比度时应显示实色回退，恢复系统设置后重新出现磨砂。关闭效果不会重写保存的主题、不透明度、大小或登录状态。
3. 检查左／右／顶部贴靠和80%／100%／130%大小；两个详情和设置文字尺寸不变。拖动不透明度与大小时检查实时响应、圆角对齐和残影。
4. 从上方快速移出再移入、收起中折返、切换两个服务、移入详情及再次点击齿轮；记录是否闪失、露边、抢焦点。收起时拉手旁和展开时详情上方的空白仍应点击穿透。
5. 完全退出后冷启动，核对开关持久化与材质恢复；再执行显示器／DPI切换、睡眠唤醒和全屏 Space。未在相应设备操作的项目保留待测。

## 结果模板

每条结果至少包含：日期、源码清单摘要、包摘要、操作系统/架构、数据来源、复现步骤、预期、实际、证据类型、状态。真实数值不用抄入报告；可记录“对应字段一致”“缺失字段”“无法对照”。失败先记录脱敏步骤，再局部修复；更新包摘要并回到原设备复测。

| 项目 | 数据来源及步骤 | 预期 | 实际与证据 | 状态 |
| --- | --- | --- | --- | --- |
| 示例：冷启动 1/3 | 真实；菜单退出后脚本启动 | 设置保留、会话恢复、重新读取 | 尚未操作 | 待测 |

最终结果集中记录在 [SIDEBAR-VALIDATION.md](SIDEBAR-VALIDATION.md)。硬件或 Windows 反馈缺失时保持部分验收状态。

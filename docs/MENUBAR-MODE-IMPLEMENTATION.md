# 菜单栏模式实施记录 · CM-MENUBAR-20261102-R1

## 范围与版本

用户于 2026-11-02 确认 R1：菜单栏展开直接复用现有悬浮窗展开后的完整卡片；撤回紧凑卡片、工具栏重排、额外压缩高度、统计二级页。用户随后确认没有其他新增或撤回条款。本记录以此为准。

- 仓库：`https://github.com/bennick1/codex-monitor.git`。
- 开工 fetch 后的 `origin/main`：`5b84121dcc2987eb8581e1a8f2ebfb31667cbbf1`，与任务书基线一致。
- 分支：`agent/menubar-quota`。
- 独立 worktree：`/Users/bennick/Work/Codex/codex-monitor/outputs/menubar-20261102/worktree`。
- 主功能提交：`c120a2e1c229a78b1224c3149fbe331c02b41935`；状态文案修复 `1feb28dae3c2423390636850ab62a8d3318b13f1`；菜单栏原生点击修复 `d82362fa905fd4ad5b467e53532c62856949211b` 为本次构建源码。
- 原工作区的旧功能分支和未跟踪历史材料保留。本轮没有写入 main、打 tag、创建 Release、触发 Signed Release 或安装覆盖正式应用。
- 正式源码版本仍为 `1.3.1`；此开发分支不代表已发布的新版本。

2026-11-03，用户确认：“本地验证通过，无问题，可以推送”。本地试用验收据此记为通过，并授权推送当前功能分支。此次仅补记验收结论，已验收的应用源码和试用制品不变；下文列明的其他平台及未覆盖原生条件仍未验证。

## 实现

macOS 增加持久化的“仅菜单栏”模式。菜单栏显示真实周期和剩余百分比；整数向下取整，介于 0 与 1 显示 `<1%`，无有效数据显示 `—`。双周期可在共享菜单中固定选短周期、周或两者，只有一个周期时不提供无效选择。仅在成功确认周期可用性后回退选择，失败不能触发账户能力变化。

三种模式消费同一 Rust `QuotaService` 快照。正常刷新五分钟，接近重置时一分钟，并在重置到达时请求刷新；失败从三十秒指数退避，最长三十分钟。并发和短时间重复手动刷新会合并。账户身份只在内存中比较，进程内 generation 阻止迟到的旧账户响应回流；同账户失败保留最后成功数据和时间，过期遵循原三十分钟策略。退出取消后台任务。本机 TokenStatisticsService 保持独立，既有额度周观测记录按原规则保留，不作为新账户的显示缓存。

`App` 只有一个 `QuotaCard` 挂载点。菜单栏始终使用展开态，保留原额度区、统计内容、总览 / 按模型 / 额度周页签和 Default / Blur / Computer / Mecha Light 样式。没有独立菜单栏卡片 CSS，没有统计二级页；Mecha 壳体沿用原几何。窗口含四周 4px 安全边距，双周期/异常为 314×514，原有 weekly-only 为 314×460，两种宿主相同。

卡片顶部保持原位置，仅适配宿主动作：

| 位置 | 悬浮窗 | 菜单栏 |
| --- | --- | --- |
| 齿轮 | 展示模式 | 共享原生“更多”菜单 |
| 展开按钮 | 保持展开开关 | 收起临时面板 |
| 图钉 | 窗口置顶 | 切回悬浮窗，保留原参数 |

菜单栏宿主不拖动、不因悬停收起、不套用浮窗整体透明度；外部点击、Esc 和收起按钮关闭临时面板。短屏可滚动，不缩小字体。原生托盘右键与卡片更多共用命令、状态和保存机制；立即刷新、三种模式、四皮肤、语言、开机启动、Codex 服务固定、DeepSeek、更新、退出均保留。手动下载仍位于原更新窗口。

定位使用实际 NSStatusItem 所属屏幕及 AppKit 逻辑坐标、visibleFrame，避免混合缩放屏幕的物理坐标重叠。进入新模式先保证入口可用；切回保留浮窗位置、侧边参数和置顶状态。DeepSeek 异步启用操作在主线程读取最新偏好后保存，避免覆盖刚切换的模式。新增能力复用 `widget` 窗口和现有调用者校验，没有向远程登录窗口开放本地命令，也未放宽 updater 签名策略。

Windows 不开放仅菜单栏；读到该模式时安全归一化为浮窗。原浮窗、侧边栏和更新路径保留。无新增框架或依赖版本升级；只为已有 AppKit 绑定启用必要 feature，锁文件未改变。

### 2026-11-03 菜单栏点击修正

用户实测旧试用版时发现：普通左键点击菜单栏图标展开操作菜单，而不是详情。此前的应用窗口和卡片交互检查没有覆盖系统托盘入口，不能替代这项实测。

锁定依赖中的 macOS 托盘实现会在创建及 `set_menu` 时向 NSStatusItem 绑定原生菜单；`show_menu_on_left_click(false)` 只改内部标志。旧实现仍在创建和额度刷新时绑定菜单，存在 AppKit 抢先处理点击的路径。现改为 macOS 不绑定自动菜单，也不在刷新时重新绑定：普通左键按下记录可见状态、释放只开关完整卡片；右键释放和 Control-click 显式打开共享操作菜单。浮窗和侧边栏同样保留右键入口。Windows 继续使用原生托盘菜单。卡片组件和样式没有改动。

新增三项点击路由回归通过，覆盖左键单一面板动作、两种 macOS 宿主的右键/Control-click，以及 Windows 原生菜单归属。2026-11-03 启动修复后的隔离 QA 包，用户实际点击顶部“周 42%”后明确确认：“左键开关详情、右键菜单均正常”。这项确认只覆盖普通左键开关和右键菜单，不扩展为全部视觉或平台验收。

修复版重新检查了 Reopen 完整卡片、更多、手动刷新和 Esc 收起；[当前 Default 卡片截图](menubar-evidence/click-fix-default-card.jpg)来自该构建。QA 于 2026-11-03 09:32（Asia/Shanghai）启动，后台间隔恢复为五分钟；完成检查后保持运行，供用户继续体验。普通 `.app` 已从相同源码重建，未自动启动或安装到正式应用位置。

## 自动化与构建

环境：macOS 27.0.1 (26A434)，arm64；Node 22.23.1，npm 10.9.8；Rust stable 1.99.1。Rust 工具链位于本任务输出目录，未改全局工具链设置。自动化只使用合成数据和临时目录。

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 按原锁文件完成；使用本任务隔离缓存 |
| `npm test` | 最终 R1 全量 443 项通过 |
| `npm run build` | 通过，含 TypeScript 检查 |
| `npm run check:updater-policy` | 通过；属于静态策略检查 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 点击修复后全量 240 通过，0 失败，2 个原有 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | 通过 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | 通过 |
| `git diff --check` | 通过 |
| `npm audit --audit-level=high` | 未通过：1 high、2 moderate，来自未改动的 Vite/Vitest 开发依赖；本轮没有无关升级 |

两个 ignored 为原有崩溃恢复子进程辅助入口和 1GiB 合成性能测试，不宣称本轮独立执行。新增回归覆盖周期解析、异常百分比、weekly-only stale、成功时间保留、账户切换及 A→B→A 迟到响应、调度退避/合并/退出、偏好兼容、菜单状态、负坐标/混合缩放定位，以及共享卡片宿主交互。

审计告警需要后续单独处理，不能据此宣称 CI 全绿。源码版本、锁文件、正式 updater 配置与签名密钥未变。原始检查输出只保存在本任务输出目录，不提交运行日志、配置、数据库、缓存、安装包或工具链。

## 原生桌面验证

QA 标识为 `app.codexmonitor.menubar.validation`，与正式 `app.quotafloat.desktop` 分离。使用隔离 CODEX_HOME、配置和数据库；只加载合成额度，不读取真实账户凭据。QA 执行的是本地编译的 Tauri 桌面应用，截图来自真实应用窗口，不是浏览器样例。

[四套皮肤并排对照](menubar-evidence/index.html)。每对采用相同合成周额度 `42.9`、同一空 Token 数据、浅色、100% 不透明度和同一系统缩放；原始截图均为 314×460，未重绘或缩放。额度、字体、间距、皮肤壳体、统计区和页签一致；顶部宿主图标/选中状态及悬停效果不同，因此不声称整图逐像素相等。健康态截图采自 `c120a2e`，后续仅补 stale 文案和原生点击路由，健康态渲染代码未变。

| 场景 | 真实桌面结果与证据 |
| --- | --- |
| 四皮肤完整卡片 | 四对 A/B 截图已检查；直接复用同组件，均为 314×460；见上方对照页 |
| 系统菜单栏入口 | `d82362f` 隔离 QA：2026-11-03 用户实测确认“左键开关详情、右键菜单均正常”；原生无内容日志也记录左键按下/释放、面板开关和右键菜单请求 |
| weekly-only | 仅周额度，无 5 小时空位，无周期选择；合成值 42.9 按原卡片精度显示 43，菜单栏格式函数向下取整为 42 |
| 隐藏时后台调度 | `1feb28d` 于 16:24:14 启动，到 16:25:08 完成 6 次成功刷新（含首次），没有面板主动显示记录；QA 间隔为 10 秒，生产仍为五分钟 |
| 卡片交互 | 原总览 / 按模型 / 额度周可切换；[额度周截图](menubar-evidence/mecha-menubar-quota-week.jpg)。更多、收起、切回浮窗均可用；Esc 后有原生隐藏记录；打开更新窗口时面板可正常失焦收起 |
| 共享菜单 | 齿轮更多、卡片右键均打开同一原生菜单，皮肤与模式命令生效；[菜单局部截图](menubar-evidence/native-more-menu-partial.jpg)仅含落在应用窗口内的部分 |
| 同账户失败 | 真实桌面进程接受合成失败状态，保留 42.9 原值和最后成功 16:25，四套皮肤未裁切：[Default](menubar-evidence/default-stale.jpg)、[Blur](menubar-evidence/blur-stale.jpg)、[Computer](menubar-evidence/computer-stale.jpg)、[Mecha](menubar-evidence/mecha-light-stale.jpg) |
| 深色可读性 | 用应用外观开关检查 [Default 深色过期态](menubar-evidence/default-dark-stale.jpg)；不等同于 OS 浅深切换实测 |
| 账户边界与恢复 | 合成账户轮次变化后[旧额度清空](menubar-evidence/account-change-unavailable.jpg)，手动刷新后[恢复真实 2 小时 + 周周期](menubar-evidence/dual-period-recovered.jpg)，共享菜单显示相应选择 |
| 三模式往返 | 菜单栏 ↔ 浮窗及菜单栏 ↔ 侧边栏完成；侧边设置继续显示右侧、100% 大小、90% 背景、玻璃开启；保存的置顶关闭和保持展开未被菜单栏改写 |
| 持久化/重新打开 | 重启保持 menubar、已选皮肤/周期，macOS Reopen 打开临时完整卡片；单周期确认后选择回退到 weekly |
| 重复启动 | 原 QA 进程存活，第二进程退出码 0；恢复后仍是菜单栏完整卡片，没有切回浮窗 |
| 更新 | [原更新窗口](menubar-evidence/update-window.jpg)可达；未配置 updater 时“打开版本下载页”按钮存在。未下载、安装或替换版本 |
| 退出 | 前轮原生菜单退出后，QA PID 已不存在；本轮通过同一退出菜单正常停止旧版，以便更换点击修复构建 |

以上失败/账户轮次为隔离合成输入，验证了真实桌面、后台调度和缓存边界，不代表真实网络或真实账户集成已经通过。当前 QA 使用 menubar / default / weekly；本轮交付时保持运行，正式配置未改。

桌面工具只能捕获应用窗口，不能完整捕获系统菜单栏及越出应用窗口的原生菜单。普通左键与右键已由用户实测确认；“菜单栏图标+文字”的完整截图、Control-click/长按、完整原生菜单截图仍未覆盖，不能以编译或应用窗口截图替代。

仍未覆盖：真实断网/联网及睡眠唤醒、真实账户切换和认证、开机自启、真实更新安装/重启、系统浅深外观切换、全屏 Space、菜单栏自动隐藏、多显示器插拔/负坐标/混合DPI实机、Windows 编译与实机。相关逻辑与合成回归不能替代这些实机条件。冷启动隐藏有进程观察，瞬时闪窗没有录屏逐帧证据；不宣称全部原生验收通过。

## 本地试用与制品

- 普通试用应用：`/Users/bennick/Work/Codex/codex-monitor/outputs/menubar-20261102/deliverables/Codex Monitor.app`。
- 隔离合成试用启动器：`/Users/bennick/Work/Codex/codex-monitor/outputs/menubar-20261102/deliverables/菜单栏隔离试用.command`（可双击，或在终端运行该文件）。
- 隔离 QA 应用：`/Users/bennick/Work/Codex/codex-monitor/outputs/menubar-20261102/worktree/src-tauri/target/debug/bundle/macos/Codex Monitor Menubar QA.app`。请通过上方启动器打开，保证合成环境和独立 CODEX_HOME 被正确设置。
- 源码 SHA：`d82362fa905fd4ad5b467e53532c62856949211b`。
- 普通应用构建时间：`2026-11-03T09:33:03.440328+08:00`；架构 **arm64 / Apple Silicon，非 Universal、非 Intel 构建**。
- 二进制 SHA-256：`e9e4480f6856f66cf4f29d4ba03894cbed5feaa7e841d451dc015e673fde7b23`。
- 机器可读记录：`/Users/bennick/Work/Codex/codex-monitor/outputs/menubar-20261102/deliverables/build-manifest.json`。
- 构建命令：`npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`；结果成功。`app,dmg` 联合构建的 DMG 封装脚本失败，随后 app-only 构建成功；本轮不交付 DMG。
- 版本仍为 `1.3.1`；普通应用只含 linker ad-hoc 签名，没有 Developer ID、notarization 或完整 bundle 资源封印。QA 包采用本地 ad-hoc 签名，也不代表 Apple 验证或正式发布。


推荐先使用隔离合成试用启动器，避免接管正式实例或改动现有数据库。该启动器只用于本机开发体验，界面中的 42.9 等数据为合成值。

正常账户试用使用普通 `.app`：先自行退出正在运行的正式 Codex Monitor，再从交付目录打开；无需拖入 Applications。它使用正式应用标识和既有配置/数据库，升级不会自动更改原展示模式。需要时可在切换前自行备份已有应用数据。此任务没有自动启动普通 `.app` 接管正式实例，也没有自动安装。

进入新模式：浮窗卡片齿轮 → 仅菜单栏，或侧边栏设置 → 展示模式 → 仅菜单栏。菜单栏展开后可通过原图钉位置“切换到悬浮窗”，或更多 → 展示方式切换。更多中的“立即刷新”刷新在线额度；统计仍使用各自原有来源和时间口径。

本轮开发成果已由用户确认本地试用验收通过，并授权推送功能分支；其他平台与上述未覆盖原生条件待验，正式发布未执行。以后若发布新版本，须重新核对版本、跨平台安装升级、生产 updater 签名与平台签名，并遵循 `docs/RELEASE.md`。旧 v1.3.1 用户仍需手动安装首个带 updater 的版本。

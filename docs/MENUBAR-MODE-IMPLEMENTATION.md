# 菜单栏模式实施记录 · CM-MENUBAR-20261102-R1

> 前文保留 R1 开发及合成试用的历史事实。2026-11-03 的依赖安全、真实账户、CI 与制品收尾见文末 `CM-MENUBAR-CLOSEOUT-20261103`，不将历史未覆盖项自动标记为通过。

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


## 收尾 · CM-MENUBAR-CLOSEOUT-20261103

### 基线与依赖安全修复

本轮沿用原 worktree 和 `agent/menubar-quota`。开工独立 fetch：远端功能分支仍为 `5874d0f8dad357f3fa0ae29cf8c635b752ce21d9`，`origin/main` 仍为 `5b84121dcc2987eb8581e1a8f2ebfb31667cbbf1`，功能分支 ahead 6 / behind 0、工作树干净。主工作区的旧分支及历史未跟踪文件未动。Git 直连先出现 HTTP2 错误及超时，随后通过本机已有系统代理成功；未更改 Git 持久配置。

旧 [push CI 41561906970](https://github.com/bennick1/codex-monitor/actions/runs/41561906970) 已到终态：frontend 的 443 项测试和构建通过，仅 audit 失败；macOS Universal 和 Windows desktop 均成功，包含制品上传。

| 依赖 | 原声明 / 原锁定 | 本轮声明 / 新锁定 | 范围与理由 |
| --- | --- | --- | --- |
| Vite（直接开发依赖） | `^7.1.5` / `7.3.6` | `^7.3.7` / `7.3.7` | 同主版本补丁；修复开发服务器及包内编辑器中间件告警 |
| Vitest（直接开发依赖） | `^4.1.11` / `4.1.11` | `^4.1.12` / `4.1.12` | 同主版本补丁；带入 mocker 安全修复 |
| `@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}`（传递依赖） | `4.1.11` | `4.1.12` | Vitest 自身的精确版本依赖必须同步 |

Vite 的 high 对应 [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)，7.x 修复版本为 7.3.7；同次更新覆盖审计中的 GHSA-698v-4r3x-3vcv、GHSA-r825-w8mm-5pxw、GHSA-9jrq-w75r-8gcw、GHSA-rq7h-c2jc-7f22。Vitest → `@vitest/mocker` 对应 [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) 和 [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)，4.x 修复版本为 4.1.12。Vite 仍要求 Node `^20.19.0 || >=22.12.0`，Vitest 仍支持 Node 22，符合本地 Node 22.23.1 与 CI Node 22。

npm 10.9.8 的定向更新触发 arborist `edgesOut` 异常，未生成变更；在任务输出目录用临时 npm 11.21.1 解析锁文件，保留仍满足范围的 chai 6.2.2、tinyrainbow 3.1.1，避免附带升级。最终使用仓库原有 npm 10.9.8 成功执行 `npm ci`。没有更改全局工具链、npm 脚本、审计门槛、Rust 输入、签名或发布配置，没有使用 `audit fix --force`。

产品/依赖成果提交：`9f34e3b6b45a3a9b0f7b0a18faa851fb73cc7c14`，仅修改 `package.json` 和 `package-lock.json`。相对已验收产品源码 `d82362f`，应用源码、组件、皮肤和统计口径没有变更；其间额外差异仅为历史记录/截图以及本轮两份依赖文件。

| 本轮本地检查 | 实际结果 |
| --- | --- |
| `npm ci` | 成功，可按锁文件安装 |
| `npm test` | 26 个测试文件、443 项测试通过 |
| `npm run build` | TypeScript 与 Vite 7.3.7 生产构建通过 |
| `npm audit --audit-level=high` | 通过；从 1 high + 2 moderate 降至 0 告警（包括开发依赖） |
| `npm run check:updater-policy` | 通过，仍仅代表静态策略检查 |
| `git diff --check` | 通过 |

Rust 源码、Cargo 清单和锁文件未变，本地复用前轮 240 passed / 2 ignored、fmt、clippy 的有效证据；本轮新 push CI 另按原配置重新执行双平台检查。所有自动化继续使用合成数据和临时目录，真实账户仅用于下述原生验证。


### 真实账户原生验证

本轮普通试用 App 从产品/依赖 SHA `9f34e3b6b45a3a9b0f7b0a18faa851fb73cc7c14` 以 release 模式构建，命令仍为 `npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`，成功。实际启动路径为原任务输出目录下 `closeout-20261103/Codex Monitor.app`，本机 **arm64 App，非 Universal、非 DMG**；构建记录时间为 2026-11-03 10:15:35（Asia/Shanghai）。二进制 SHA-256 为 `e9e4480f6856f66cf4f29d4ba03894cbed5feaa7e841d451dc015e673fde7b23`，与前轮普通 App 相同：依赖补丁没有改变本轮产出的应用二进制。构建命令在本轮 SHA 上实际执行，未将旧包改名冒充重建。

已先核实并正常退出 Applications 中的旧 Monitor 与隔离合成 QA。10:11:51 在无 Monitor 进程写入时备份既有偏好、窗口状态及统计库/WAL/SHM，备份库 `PRAGMA quick_check` 为 `ok`。备份仅留在任务输出目录，未备份或复制认证文件；未覆盖 Applications 中的正式安装。实际运行进程先为 6357，重启后为 6793，均指向上述普通试用路径。未启动隔离试用 `.command`，进程无合成额度、fixture、加速轮询或 updater-test 环境；release 构建也不开放 debug 合成路径。`CODEX_HOME` 未被覆盖，沿用默认现有登录态和正式应用数据目录。

以下时间均为 2026-11-03 Asia/Shanghai。只读取已有额度观测表中的时间、周期重置和百分比作为脱敏证据，不读取或输出账号标识、令牌、认证响应；没有修改数据库结构或清空历史。

| 项目 | 实际结果 |
| --- | --- |
| 首次读取 | 启动后卡片由 loading 转为“额度数据已同步”，实测真实周剩余 **83%**；重置 **11/7 07:36**，服务解析后的精确重置为 `2026-11-06T23:36:45Z`。仅周额度，无 5 小时区、无无效周期菜单。首次请求没有新增该次 quota observation；代码在统计 source root 尚未就绪时会跳过写入，但未单独采集当时 root 状态，因此不将此推测当作已证实原因。首次成功依据原生卡片状态，不伪造数据库时间。 |
| 同一来源 | 菜单栏 `update_tray` 与 `widget` 的 `snapshots-updated` 在同一 `publish` 中使用同一 `QuotaService` 快照；账户作用域在请求前后校验，本轮无账户切换。菜单栏向下取整、卡片沿用原精度，规则未改。系统菜单栏文字无法由当前窗口截图工具完整捕获，未伪称取得菜单栏和卡片的独立数值截图。 |
| 手动刷新 | 原生“立即刷新”完成，新增成功观测为 **10:17:44.339**，周剩余 83%，重置不变；该观测只在实际成功请求后写入，非缓存读取时间。 |
| 关闭后的正常后台刷新 | 收起面板后不再对 Monitor 发出 Reopen/读取窗口操作；在 **10:23:26**、重新打开面板之前，只读数据库发现 **10:22:46.782** 的新成功记录。距手动成功 **302.443 秒**，符合生产五分钟调度加请求/轮询耗时。仍为 83% 不影响成功结论。随后重新打开卡片，显示已同步、周剩余 83%。没有缩短刷新周期或主动消耗额度。 |
| 正常退出与重启 | 通过应用“退出 Codex Monitor”，进程消失；重新启动同一 App 后保持 `displayMode=menubar`、`selectedSkin=mecha-light`、`menubarQuotaDisplay=weekly`、原 `appearance=dark` 偏好。**10:25:57.665** 再次真实取数成功，周剩余 **82%**，重置不变；Reopen 后卡片显示 82% 和已同步。额度变化来自正常账户活动，本轮未制造付费请求。 |
| 最小交互 | 完整卡片可恢复、收起；卡片右键和更多打开共享菜单；手动刷新有效；原总览/按模型/额度周可达。系统托盘普通左键开关及右键入口保留前轮用户验收，相关源码及本轮普通 App 二进制均未变；本轮工具未重新完成系统托盘物理左/右键实测，不将 Reopen 冒称为左键。 |
| 更新入口 | 原软件更新窗口可达，显示当前 1.3.1 和“在线更新未配置，请打开版本下载页”；未下载、安装更新或改签名配置。 |

正常成功态卡片沿用原“已同步”指示，未为验证新增时间 UI。最后成功时间取自现有成功观测记录；菜单栏 tooltip 本身使用同一快照的 `updated_at`，未将两个共享缓存的界面当成独立准确性证明。没有可用的独立官方额度页面/客户端对照证据，本轮证明的是正常认证取数、快照流转、手动/后台刷新及重启恢复，不宣称服务端绝对准确性已经独立校验。

原四皮肤/R1 样式和此前用户的合成试用视觉验收保留，不重新设计或要求全部皮肤重验。真实账户验证未发现需修改的取数链路，因此产品源码没有新增修复。配置和历史统计保留，试用 App 留在菜单栏模式供继续使用。

### 产品提交 CI、制品与同步

产品/依赖 SHA、试用构建 SHA、以下 CI 的 `head_sha` 均为 **`9f34e3b6b45a3a9b0f7b0a18faa851fb73cc7c14`**。原界面/业务源码的最后修改仍为 `d82362f`；这两个概念不混用。

[本次产品 push CI 41564892592](https://github.com/bennick1/codex-monitor/actions/runs/41564892592)：事件 `push`，分支 `agent/menubar-quota`，最终 `completed / success`。

| Job | 终态与关键结果 |
| --- | --- |
| [frontend](https://github.com/bennick1/codex-monitor/actions/runs/41564892592/job/125683934676) | success；npm ci、updater policy、26 项发布脚本测试、443 项前端测试、TypeScript/生产构建、audit 全部通过，audit 为 0 告警 |
| [macOS Universal desktop](https://github.com/bennick1/codex-monitor/actions/runs/41564892592/job/125683934979) | success；fmt、Rust tests、clippy、签名归档身份绑定测试、Universal 打包、上传通过 |
| [Windows desktop](https://github.com/bennick1/codex-monitor/actions/runs/41564892592/job/125683934961) | success；fmt、Rust tests、clippy、打包、Windows GUI subsystem 检查、上传通过 |

| 制品 | 来源与实际完整性核对 |
| --- | --- |
| [codex-monitor-macos-universal-unsigned](https://github.com/bennick1/codex-monitor/actions/runs/41564892592/artifacts/13197639696) | ID `13197639696`，33,009,087 bytes；ZIP SHA-256 `2a23de500fd78496f4473505b24878f43ab8c88c7ccfe5d64973c8e691911659` 与 GitHub digest 一致，ZIP 校验通过。内含 `.app` 与 `Codex Monitor_1.3.1_universal.dmg`；App 主程序 `lipo -archs` 为 `x86_64 arm64`。DMG SHA-256 `2910dedd27ffdf21d1508d837933d754034561585e63dd064bf011232a69de6d`，`hdiutil verify` 为 VALID。 |
| [codex-monitor-windows-unsigned](https://github.com/bennick1/codex-monitor/actions/runs/41564892592/artifacts/13199515252) | ID `13199515252`，12,532,752 bytes；ZIP SHA-256 `ef33c722062d90af2badab49197b6600abb87ae728023fd09877a1d60eead472` 与 GitHub digest 一致，ZIP 校验通过。内含 x64 MSI（7,368,704 bytes）和 NSIS setup EXE（5,413,938 bytes）。 |

两份制品都核实绑定本次 `9f34e3b`、未过期，保留期至 2026-11-17。已在本机任务输出目录下载核验。CI 的 Universal DMG 成功解决本轮交付的 Mac 包来源问题，无需再次修本机历史 DMG 脚本；本机 arm64 App 的原生验证不等于 Intel 实机验证。制品属于普通 unsigned CI，不是 Signed Release；没有 Developer ID/notarization 或正式更新签名验收。

产品提交普通 push 后已独立 fetch，local HEAD 和 `origin/agent/menubar-quota` 均为 `9f34e3b6b45a3a9b0f7b0a18faa851fb73cc7c14`，remote-only/local-only **0/0**。本节作为后续**仅文档记录提交**：只修改本文，产品、依赖、构建输入和工作流不变；上面的原生结果、构建与制品明确属于 `9f34e3b`。记录提交自身的 SHA、push CI 终态和再次同步核验以本轮最终回复提供，不把产品 CI 冒称为记录提交的 CI。

### 保留项与后续边界

真实账户首次取数、手动刷新、正常后台刷新与重启恢复已补齐。仍未覆盖真实账户切换、断网恢复、睡眠唤醒、开机自启、全屏 Space、菜单栏自动隐藏、多屏/混合 DPI、Control-click/长按、Intel/Windows 实机及完整在线升级；本轮仅保留已确认托盘左/右键验收，没有新增系统菜单栏全景截图。Windows 编译/打包现已通过，不再写成“Windows 未编译”，但不等于 Windows 实机验收。

只在功能分支提交和普通推送；未合并/写 main、强推、更改正式版本、打 tag、创建 Release、触发 Signed Release、修改发布/签名配置或安装覆盖正式应用。后续合并准备可使用上述精确 SHA 和证据；正式发布继续单独处理平台安装/升级、updater 与平台签名及发布授权。

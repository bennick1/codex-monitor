# Desktop widget fixes — 2026-09-05

**R1 全屏人工验收失败；R2 代码修订完成，待用户实机复验。** 用户确认测试的是上次提供的本机 `.app`，失败操作是在桌面与不同原生全屏 Space 之间切换，悬浮窗没有跟随。不是旧安装包或应用内页面切换问题。R2 的构建、启动和窗口操作检查不能代替全屏验收。

## 基线与提交

- 仓库：`bennick1/codex-monitor`，当前分支 `main`，开始时工作区干净。
- 基线 / Step 3：`8a46829d2b1240628e5dc09dc38ce029b7c50e70`。对应任务已结束，Token 后端已本地提交；没有同工作树并行修改。
- A：`11e7c7e9a9f060ac7ab58bca83f78c9a406ab14b` — 移除付费与皮肤运行时。
- B / R1：`884ec79bd4a3ebab666c33efb844d74b151bc905` — macOS 窗口与状态恢复修复；上述人工验收失败。
- R2 开始基线：`faafb2e27c8a2f2cca221c982a66c246b7b6390e`，`main`，工作区干净。
- B / R2：`13a051a52fab8ac91aa655265931b746ab617bd7` — 窗口创建前启用 Accessory 策略，增加本机包的 agent 启动配置。
- 本报告另行提交。以上均为本地提交；本轮未推送、打 tag、发布 Release 或制作正式安装包。
- 相对基线，`src-tauri/src/token_stats/**`、`codex.rs`、Token TS 契约及其测试无差异；未改变 Token 口径、数据库设计、采集逻辑或实现 Token UI。

## A：清理与兼容

移除了托盘赞赏顶级项、付费皮肤子菜单、supporter 窗口配置、URL 页面入口、设计预览中的付费页/皮肤、SupporterPanel、三个授权 commands、授权事件、设备码读取、三天提醒判断及启动线程。默认皮肤只保留浅色、深色、跟随系统。两套付费皮肤的组件分支、CSS、图片、专用字体和测试一起移除，没有开放皮肤或伪造授权。

偏好模型不再声明许可证、解锁标记、选中皮肤和提醒字段。Serde 忽略旧字段（包括过期字段类型错误），前端只渲染默认皮肤；后续正常保存不再写入这些字段。语言、位置文件、置顶、锁定、固定服务、展开偏好及统计库保留。没有清空真实配置目录。迁移测试使用临时目录、合成旧设置、数据库哨兵文件及位置文件，覆盖旧备份恢复。

依赖引用核对：`base64` 仍供 quota 使用，`sha2` 仍供 Token 使用，均保留。仅删除应用直接依赖的 `ed25519-dalek` 和 `winreg`；传递依赖按 Cargo 自动收敛，无版本升级。更新插件及其 `minisign-verify`、公钥、校验流程保留。根 LICENSE、版权、第三方字体声明保留。上游历史说明及独立维护者工具未纳入桌面包，也未扩大清理范围。

## B：复现边界、判断与方案

**R1 失败来自用户实机反馈，代理没有独立复现目标应用。** 图形工具拒绝操作 `com.openai.codex`（返回 “Computer Use is not allowed … for safety reasons”）。本机 `/Applications/ChatGPT.app` 实际也使用该标识，版本 `26.901.20858 / 7658`；未发现单独的 `/Applications/Codex.app`，不能把同一应用视为两种应用分别验收。R1 测试包图形连接曾两次超时；R2 已成功连接、观察球形渲染并操作卡片。没有新增系统权限或绕过工具限制。

已确认的源码问题：

1. 原窗口缺少跨 Space 标志。锁定的 tao 0.35.3 中，`set_visible_on_all_workspaces` 只操作 `CanJoinAllSpaces`，不能据此保证其他应用的原生全屏可见。
2. tao 的 `show()` 使用 make-key 路径；window-state 2.4.1 恢复 VISIBLE 会调用 `show()` 和 `set_focus()`，且默认还能恢复 FULLSCREEN/MAXIMIZED。
3. 原单实例唤起、托盘显示和 macOS debug 启动路径均主动聚焦，debug 延时线程还会重新显示用户刚隐藏的窗口。

R1 已处理以下路径，R2 继续保留；代码隔离在 `#[cfg(target_os = "macos")]` 的 `macos_widget.rs`：

- 原生主线程设置 `CanJoinAllSpaces + FullScreenAuxiliary`；运行时检测 macOS 13.0+，再选择 `CanJoinAllApplications`。先清除 MoveToActiveSpace、全屏主窗口/禁用全屏、Primary/Auxiliary 等对应互斥项，保留无关标志。
- 窗口初建隐藏且不聚焦；完成策略和几何恢复后，按旧状态决定是否显示。仅初次显示或用户明确请求时调用 `orderFrontRegardless()`，已显示则不反复置前。
- 状态插件跳过自动恢复 widget，手动只恢复位置/尺寸；继续保存位置、尺寸和可见性。显示/隐藏后保存状态；刷新和 Resumed 仅触发原有数据刷新，不显示、不聚焦。
- 置顶仍使用 tao 同样的 `NSFloatingWindowLevel`，关闭立即恢复 `NSNormalWindowLevel`。不设置 widget 全屏、不持续置前、不模拟点击。
- 原生指针只在主线程取得和使用；非主线程请求通过 Tauri 调度并返回操作结果。复用已锁定的 objc2 0.6.4 / objc2-app-kit 0.3.2，只增加 macOS 直接引用，未增加新的锁文件包。

**R2 原因判断与修订：** 用户失败结果说明 Regular 应用的普通 NSWindow 即使带上述标志，也不足以保证本机全屏 Space 跟随。Tauri 2.11.5 默认在 setup 之前创建配置中的窗口；tao 0.35.3 在应用启动时应用激活策略。R2 在 `App::run` 之前设置 Accessory，并用 `Info.plist` 的 `LSUIElement=true` 让打包应用从 LaunchServices 启动时就是 agent。macOS widget 配置改为延迟创建；托盘成功后，在主线程核验实际 NSApplication 已是 Accessory、实际存在 main 托盘，再创建隐藏的窗口、恢复几何并应用 Space 策略。实际 `.app` 成功创建窗口，证明这两项启动检查通过。

**行为影响：** macOS 改为托盘应用，不出现在 Dock / Command-Tab 中；显示、解锁、退出由已有托盘入口提供。托盘失败则在创建 widget 前终止启动，不能留下无法操作的隐藏实例。仍使用 NSWindow，没有引入 NSPanel 框架、新的锁文件依赖包、Space 监听器、轮询置前或聚焦循环；只为已有 macOS AppKit 依赖启用 NSApplication 绑定。Windows 保留自动建窗、任务栏回退及原置顶行为，macOS 的 Info.plist 不用于 Windows 包。

**仍需实机判断的风险：** Accessory 是针对 R1 失败的下一步最小修订，不是已验证的根因结论。macOS 13 以下、Dock/Command-Tab 的实际表现及跨全屏行为仍需复验。tao 自身启动时的激活调用没有被重写；“先全屏再启动”是否切 Space 或抢焦点必须实测，不能从移除窗口 set_focus 推断。后台刷新、Space 切换、鼠标悬停没有新增显示/激活调用；原生置顶关闭仍回到 level 0，用户隐藏状态继续保留。

依据：[Apple collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)、[FullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)、[无 key 显示](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless())、[tao 0.35.3 源码](https://github.com/tauri-apps/tao/blob/tao-v0.35.3/src/platform_impl/macos/window.rs)。版本行为同时核对本机 Cargo registry 中的 Tauri 2.11.5、tao 0.35.3 和 window-state 2.4.1 源码；macOS SDK NSWindow.h 确認新标志从 13.0 可用。

R2 依据：[Apple ActivationPolicy](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum)、[LSUIElement](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement)、[tao 0.35.3 启动实现](https://github.com/tauri-apps/tao/blob/tao-v0.35.3/src/platform_impl/macos/app_state.rs)。[Tauri 上游相似问题](https://github.com/tauri-apps/tauri/issues/11488)提供 Accessory 方向的参考，但版本较旧，不作为本机 R2 通过的证明。

## 构建与测试证据

环境：macOS **26.6.2 / 25G83**，Apple arm64；Tauri **2.11.5**，tao **0.35.3**，wry **0.55.1**，window-state **2.4.1**；CLI 2.11.4，Rust 1.98.1，Node 22.23.1。

实际生成 release / arm64 `.app`，使用相同代码、独立 QA identifier 和命令行临时关闭 updater 制品生成。跳过本机包签名，不改仓库签名配置或更新验签机制；该包只供本机验证。

```sh
PATH=/private/tmp/codex-monitor-cargo/bin:$PATH \
CARGO_HOME=/private/tmp/codex-monitor-cargo \
RUSTUP_HOME=/private/tmp/codex-monitor-rustup \
node_modules/.bin/tauri build --bundles app --no-sign \
  --config '{"identifier":"app.quotafloat.widget-qa-r2-20260905","bundle":{"createUpdaterArtifacts":false}}'
```

- R2 固定交付副本：[Quota Float.app](../outputs/desktop-widget-fullscreen-r2/Quota%20Float.app)；绝对路径 `/Users/bennick/Work/Codex/codex-monitor/outputs/desktop-widget-fullscreen-r2/Quota Float.app`，不依赖下次构建可能覆盖的 target 目录。版本仍为 0.2.4，不进行产品重命名或发布版本改造。
- 可执行文件 SHA256：`05794fed17c253865869f6b9ccb010a206416cdc622a5ccce7bd122dfe4946b1`；实查 bundle identifier 为 `app.quotafloat.widget-qa-r2-20260905`、`LSUIElement=true`。与 R1 标识不同，避免旧单实例进程拦截新包启动。
- 最终 release 编译 26.87s；实际启动该副本、观察到悬浮球、点击展开卡片，置顶按钮由 on 切至 off 再恢复 on。只证明这些窗口操作和调用链可用，不证明全屏覆盖、鼠标离开收起或其他应用持续输入无焦点损失。
- 尝试将空白 TextEdit 窗口切入原生全屏并恢复。工具返回单窗口截图，无法据此证明 widget 与其他窗口在同一 Space 叠加可见；不记为全屏通过。测试文本窗口已退出，没有私人聊天或代码画面。
- R2 QA 标识的 Application Support、Caches、WebKit 目录单独映射到 `/private/tmp/codex-monitor-widget-qa-r2-20260905/{config,cache,webkit}`。真实应用标识及其数据目录未改动；临时采集数据与测试包没有提交。
- R1 历史包：标识 `app.quotafloat.widget-qa-20260905`，可执行文件 SHA256 `70c8e2d13b8e2613d17fa966dd45ed6ae7e20a08dcb8e0cb9b85335b45c56a84`；其 Space 切换人工验收失败，勿继续用它复验 R2。

| 验收项 | 结果与证据 |
|---|---|
| Rust 回归、quota / Token 后端 | **通过**：53 passed，0 failed；2 ignored 为原有崩溃子进程辅助入口和 1 GiB 性能用例。本轮未重跑大规模性能用例，Token 源码无差异 |
| 前端回归 | **通过**：7 个文件、25 项；含旧 supporter URL 回退、双语言/双配色卡片、Hover/拖动/按钮事件及既有 Token 契约 |
| 前端构建、Rust release `.app` 构建 | **通过**，不是 tauri dev 或浏览器包代替桌面构建 |
| Clippy 全 targets 严格检查 | **通过**：`cargo clippy --all-targets --locked -- -D warnings` |
| 格式与 diff | 新 macOS 模块、models 格式检查和 `git diff --check` **通过**；全库 `cargo fmt --check` **失败**，lib.rs 仍有既有排版及沿用的长托盘菜单行，未做全文件格式重写 |
| 全新配置 / 旧许可证、皮肤、超过三天提醒日期 | 临时配置自动测试**通过**；保留有效偏好、数据库哨兵及位置文件，旧字段忽略；实际 GUI 启动后的菜单/无弹窗验收**未执行** |
| 旧 command / 事件 / 页面重开付费入口 | 源码、配置、release 二进制检查**通过**：无旧注册、调度、页面和设备码实现；实际 GUI command 调用与控制台错误观测**未执行** |
| 中英文菜单、浅色/深色/跟随系统 | 卡片自动测试和菜单源码检查**通过**；实际托盘切换、OS 主题响应**未执行** |
| 修改前：普通桌面、最大化、ChatGPT 原生全屏、Codex 原生全屏 | **均未执行图形复现**，受上述环境限制；原因判断来自源码，不是录屏复现 |
| R2 窗口渲染 / 点击展开 / 置顶按钮 | 实际 `.app` 单窗口观察及操作**通过**；最大化应用覆盖、层级遮挡和离开收起**待用户实机验收** |
| 先启动 widget 再进入 ChatGPT 全屏 | **待用户实机验收** |
| 先 Codex 全屏再启动 widget | **待用户实机验收** |
| 桌面及不同全屏 Space 来回切换 | **R1 人工验收失败**（用户确认使用上次本机包）；**R2 待用户实机复验** |
| 全屏 Hover 展开/收起、拖动、点击、继续输入且不抢焦点 | **待用户实机验收**；前端事件测试不能替代 |
| 隐藏/显示、置顶开关、锁定/解锁、重启、睡眠唤醒 | 原生状态策略/合成可见性测试**通过**；实际行为**待用户实机验收** |
| Accessory 策略与托盘存在性 | R2 实际启动时两项原生检查**通过**；托盘菜单实操、故障注入与 Dock/Command-Tab 观察**未执行** |
| 外接显示器、不同缩放、Stage Manager、旧 macOS | **未执行**，没有可操作的相应验收环境 |
| Windows 编译 / Windows 实机运行 | **均未执行**；本机仅安装 aarch64-apple-darwin target，无 Windows 编译链/实机，不能以 macOS 构建代替 |

本轮只观察悬浮球与空白文本截图，没有采集私人聊天、代码或账号画面，未新增屏幕录制、辅助功能或其他安全权限要求。R2 Rust、Clippy、最终 `.app` 构建日志分别为 `/private/tmp/codex-monitor-r2-{rust,clippy,app-final}.log`；前端 7 文件 / 25 项回归再次通过（工具输出），Info.plist lint 与 diff 检查通过。R1 日志仍保留在 `/private/tmp/codex-monitor-{frontend-final,B-final-rust,B-final-clippy,app-final-build,format-final}.log`，均不入库。

## 用户实机验证与发布阻塞

1. 先从旧测试包托盘退出，再打开上述 `outputs/desktop-widget-fullscreen-r2/Quota Float.app`。确认“显示”和“始终置顶”开启，先重点复验桌面与不同原生全屏 Space 的来回切换。R2 从托盘操作，Dock / Command-Tab 中没有入口。
2. 配置兼容只使用 `/private/tmp/codex-monitor-widget-qa-r2-20260905/config`，保留真实配置和统计库。先空配置启动，再退出后放入合成旧偏好（例如旧皮肤 computer、任意旧 license、`supporterPromptFirstSeenAt: "2000-01-01T00:00:00Z"`），确认仍是默认外观、没有赞赏提醒，语言/置顶/锁定保留。
3. 在无私人内容的 ChatGPT 新会话画面中，用绿色全屏按钮进入独立 Space；确认先启动的球仍可见。另在独立 Codex.app 先进入原生全屏，再启动球；不要把最大化当成此测试。
4. 在桌面及两个全屏 Space 间切换，悬停展开并移走收起，拖动、点击按钮后继续在测试输入框打字（不发送），确认不丢焦点、不退出全屏、不回普通桌面。
5. 隐藏后切 Space/刷新/唤醒应保持隐藏；托盘显示应恢复。分别关闭/开启置顶，验证普通层级/浮动层级。用合成 locked 配置检查鼠标穿透和托盘解锁，再测试退出重启和睡眠唤醒。有条件再补显示器、缩放和 Stage Manager。

**发布前阻塞：内置更新仍指向 `change-42-yhmm/quota-float`。二开包可能被上游版本替换并失去 Token 后端及本轮修改。** 本轮没有安装上游更新，也未修改更新服务、公钥、验签或发布流程。全屏实机验收完成前，不把本修复标记为已通过，不进入 Token UI 或发布工作。

# Desktop widget fixes — 2026-09-05

**代码修改完成；全屏实机验收未通过验收流程，状态为待用户实机验收。** 未将配置、编译或进程启动证据当作全屏行为通过。

## 基线与提交

- 仓库：`bennick1/codex-monitor`，当前分支 `main`，开始时工作区干净。
- 基线 / Step 3：`8a46829d2b1240628e5dc09dc38ce029b7c50e70`。对应任务已结束，Token 后端已本地提交；没有同工作树并行修改。
- A：`11e7c7e9a9f060ac7ab58bca83f78c9a406ab14b` — 移除付费与皮肤运行时。
- B：`884ec79bd4a3ebab666c33efb844d74b151bc905` — macOS 窗口与状态恢复修复。
- 本报告另行提交。以上均为本地提交；本轮未推送、打 tag、发布 Release 或制作正式安装包。
- 相对基线，`src-tauri/src/token_stats/**`、`codex.rs`、Token TS 契约及其测试无差异；未改变 Token 口径、数据库设计、采集逻辑或实现 Token UI。

## A：清理与兼容

移除了托盘赞赏顶级项、付费皮肤子菜单、supporter 窗口配置、URL 页面入口、设计预览中的付费页/皮肤、SupporterPanel、三个授权 commands、授权事件、设备码读取、三天提醒判断及启动线程。默认皮肤只保留浅色、深色、跟随系统。两套付费皮肤的组件分支、CSS、图片、专用字体和测试一起移除，没有开放皮肤或伪造授权。

偏好模型不再声明许可证、解锁标记、选中皮肤和提醒字段。Serde 忽略旧字段（包括过期字段类型错误），前端只渲染默认皮肤；后续正常保存不再写入这些字段。语言、位置文件、置顶、锁定、固定服务、展开偏好及统计库保留。没有清空真实配置目录。迁移测试使用临时目录、合成旧设置、数据库哨兵文件及位置文件，覆盖旧备份恢复。

依赖引用核对：`base64` 仍供 quota 使用，`sha2` 仍供 Token 使用，均保留。仅删除应用直接依赖的 `ed25519-dalek` 和 `winreg`；传递依赖按 Cargo 自动收敛，无版本升级。更新插件及其 `minisign-verify`、公钥、校验流程保留。根 LICENSE、版权、第三方字体声明保留。上游历史说明及独立维护者工具未纳入桌面包，也未扩大清理范围。

## B：复现边界、判断与方案

**未成功进行修改前的图形复现。** 图形工具拒绝操作 `com.openai.codex`（返回 “Computer Use is not allowed … for safety reasons”）。本机 `/Applications/ChatGPT.app` 实际也使用该标识，版本 `26.901.20858 / 7658`；未发现单独的 `/Applications/Codex.app`，不能把同一应用视为两种应用分别验收。测试包随后两次图形连接也返回 `-10005: timeoutReached`。没有新增系统权限或改用其他 UI 自动化手段绕过限制。

已确认的源码问题：

1. 原窗口缺少跨 Space 标志。锁定的 tao 0.35.3 中，`set_visible_on_all_workspaces` 只操作 `CanJoinAllSpaces`，不能据此保证其他应用的原生全屏可见。
2. tao 的 `show()` 使用 make-key 路径；window-state 2.4.1 恢复 VISIBLE 会调用 `show()` 和 `set_focus()`，且默认还能恢复 FULLSCREEN/MAXIMIZED。
3. 原单实例唤起、托盘显示和 macOS debug 启动路径均主动聚焦，debug 延时线程还会重新显示用户刚隐藏的窗口。

采用最小 NSWindow 修复，代码隔离在 `#[cfg(target_os = "macos")]` 的 `macos_widget.rs`：

- 原生主线程设置 `CanJoinAllSpaces + FullScreenAuxiliary`；运行时检测 macOS 13.0+，再选择 `CanJoinAllApplications`。先清除 MoveToActiveSpace、全屏主窗口/禁用全屏、Primary/Auxiliary 等对应互斥项，保留无关标志。
- 窗口初建隐藏且不聚焦；完成策略和几何恢复后，按旧状态决定是否显示。仅初次显示或用户明确请求时调用 `orderFrontRegardless()`，已显示则不反复置前。
- 状态插件跳过自动恢复 widget，手动只恢复位置/尺寸；继续保存位置、尺寸和可见性。显示/隐藏后保存状态；刷新和 Resumed 仅触发原有数据刷新，不显示、不聚焦。
- 置顶仍使用 tao 同样的 `NSFloatingWindowLevel`，关闭立即恢复 `NSNormalWindowLevel`。不设置 widget 全屏、不持续置前、不模拟点击。
- 原生指针只在主线程取得和使用；非主线程请求通过 Tauri 调度并返回操作结果。复用已锁定的 objc2 0.6.4 / objc2-app-kit 0.3.2，只增加 macOS 直接引用，未增加新的锁文件包。

保留普通 NSWindow 和 Regular 激活策略，没有切换 Accessory、改变 Dock/Command-Tab 策略或引入 NSPanel 框架。macOS 托盘初始化失败会终止启动，避免留下隐藏/穿透且无法操作的实例；Windows 保留原任务栏回退及窗口行为。

**仍需实机判断的风险：** Apple 将跨应用全屏描述为符合条件时可加入，当前标志不是行为证明。macOS 13 以下只使用旧 Space/FullScreenAuxiliary 路线，兼容性尚未验证；也没有证据证明当前 NSWindow 修复后仍失败，因此尚未升级到 NSPanel 或改变激活策略。tao 的进程启动激活机制保持上游默认；“先全屏再启动”是否切 Space 必须实测，不能从移除窗口 set_focus 推断。

依据：[Apple collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)、[FullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)、[无 key 显示](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless())、[tao 0.35.3 源码](https://github.com/tauri-apps/tao/blob/tao-v0.35.3/src/platform_impl/macos/window.rs)。版本行为同时核对本机 Cargo registry 中的 Tauri 2.11.5、tao 0.35.3 和 window-state 2.4.1 源码；macOS SDK NSWindow.h 确認新标志从 13.0 可用。

## 构建与测试证据

环境：macOS **26.6.2 / 25G83**，Apple arm64；Tauri **2.11.5**，tao **0.35.3**，wry **0.55.1**，window-state **2.4.1**；CLI 2.11.4，Rust 1.98.1，Node 22.23.1。

实际生成 release / arm64 `.app`，使用相同代码、独立 QA identifier 和命令行临时关闭 updater 制品生成。跳过本机包签名，不改仓库签名配置或更新验签机制；该包只供本机验证。

```sh
PATH=/private/tmp/codex-monitor-cargo/bin:$PATH \
CARGO_HOME=/private/tmp/codex-monitor-cargo \
RUSTUP_HOME=/private/tmp/codex-monitor-rustup \
node_modules/.bin/tauri build --bundles app --no-sign \
  --config '{"identifier":"app.quotafloat.widget-qa-20260905","bundle":{"createUpdaterArtifacts":false}}'
```

- 产物：`src-tauri/target/release/bundle/macos/Quota Float.app`。
- 最终可执行文件 SHA256：`70c8e2d13b8e2613d17fa966dd45ed6ae7e20a08dcb8e0cb9b85335b45c56a84`。
- 初次 release 构建 2m33s；最终 B 提交重建 33.67s。初次产物由图形工具启动，PID 69338；只读线程采样显示正常 AppKit 事件循环，未发现初始化卡死。测试实例已终止。最终重建产物尚未进行图形交互。
- QA 标识的 Application Support、Caches、WebKit 目录单独映射到 `/private/tmp/codex-monitor-widget-qa-20260905/{config,cache,webkit}`。真实应用标识及其数据目录未改动；临时采集数据没有提交。

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
| 修改后：桌面 / 最大化可见 | 仅确认 `.app` 进程启动；可见性与交互**未执行验收** |
| 先启动 widget 再进入 ChatGPT 全屏 | **待用户实机验收** |
| 先 Codex 全屏再启动 widget | **待用户实机验收** |
| 桌面及两个全屏 Space 来回切换 | **待用户实机验收** |
| 全屏 Hover 展开/收起、拖动、点击、继续输入且不抢焦点 | **待用户实机验收**；前端事件测试不能替代 |
| 隐藏/显示、置顶开关、锁定/解锁、重启、睡眠唤醒 | 原生状态策略/合成可见性测试**通过**；实际行为**待用户实机验收** |
| 托盘失败退出、Dock/Command-Tab 行为 | 源码检查完成；故障注入与 GUI 行为**未执行** |
| 外接显示器、不同缩放、Stage Manager、旧 macOS | **未执行**，没有可操作的相应验收环境 |
| Windows 编译 / Windows 实机运行 | **均未执行**；本机仅安装 aarch64-apple-darwin target，无 Windows 编译链/实机，不能以 macOS 构建代替 |

本轮未采集含私人内容的截图或录屏，也未新增屏幕录制、辅助功能或其他安全权限要求。测试日志保存在 `/private/tmp/codex-monitor-{frontend-final,B-final-rust,B-final-clippy,app-final-build,format-final}.log`，不入库。

## 用户实机验证与发布阻塞

1. 用上述 QA `.app` 测试；仅更改其 `/private/tmp/codex-monitor-widget-qa-20260905/config` 内的配置，保留真实配置和统计库。先空配置启动，再退出后放入合成旧偏好（例如旧皮肤 computer、任意旧 license、`supporterPromptFirstSeenAt: "2000-01-01T00:00:00Z"`），确认仍是默认外观、没有赞赏提醒，语言/置顶/锁定保留。
2. 在无私人内容的 ChatGPT 新会话画面中，用绿色全屏按钮进入独立 Space；确认先启动的球仍可见。另在独立 Codex.app 先进入原生全屏，再启动球；不要把最大化当成此测试。
3. 在桌面及两个全屏 Space 间切换，悬停展开并移走收起，拖动、点击按钮后继续在测试输入框打字（不发送），确认不丢焦点、不退出全屏、不回普通桌面。
4. 隐藏后切 Space/刷新/唤醒应保持隐藏；托盘显示应恢复。分别关闭/开启置顶，验证普通层级/浮动层级。用合成 locked 配置检查鼠标穿透和托盘解锁，再测试退出重启和睡眠唤醒。有条件再补显示器、缩放和 Stage Manager。

**发布前阻塞：内置更新仍指向 `change-42-yhmm/quota-float`。二开包可能被上游版本替换并失去 Token 后端及本轮修改。** 本轮没有安装上游更新，也未修改更新服务、公钥、验签或发布流程。全屏实机验收完成前，不把本修复标记为已通过，不进入 Token UI 或发布工作。

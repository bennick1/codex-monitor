# 主分支合并与功能回归

## 合入 main 后的再次验收（2026-10-13）

结论：本地 `main` 已同步远端 `9f76955`，再无冲突合入功能分支 `67b8629`；本轮自动检查及下述 Mac 原生复测通过，未发现新增回归。未推送 `main`、未发布；以下历史记录中的“当前分支”指上一轮验收时的分支。

合并后的索引在添加本节记录前与 `67b8629` 完全一致，本轮不修改产品代码。两个 GPT-6.1 SOL 子智能体分别负责前端、Rust/发布脚本复测，主智能体复核结果及原生界面。证据目录：`outputs/main-integration-validation-20261013/`。

| 检查 | 本轮实际结果 |
| --- | --- |
| `npm test`、`npm run build` | 25 文件、405 项通过；TypeScript/Vite 构建通过 |
| `npm run check:updater-policy` | 通过；普通 push 不触发发布，正式发布仍受 main 手动门禁约束 |
| Rust all-targets、fmt、Clippy | 207 项通过（库 206、验签示例 1）、2 项 ignored；格式与 `-D warnings` 通过 |
| 发布脚本、合成签名复测 | 26/26 通过；启用真实临时测试签名验证器后重跑仍 26/26 |
| DeepSeek 读取脚本单独复测 | 3/3 通过；不代表登录网站实测 |
| 版本、锁文件、依赖审计 | 六处版本均 1.3.1，锁文件一致；`npm audit --audit-level=high` 为 0 项漏洞 |
| Mac 模式和入口 | Codex/DeepSeek 详情、设置、Mecha 悬浮窗及总览/按模型/额度周页签、切回侧边栏均正常 |
| Mac 玻璃和齿轮 | 毛玻璃关/开可响应；再次点齿轮仅关闭设置面板，栏体继续展开 |
| Mac 更新窗口 | 实际打开 `?updates=1` 原生窗口，显示 QA 版本 0.0.2，手动检查本地 manifest 后显示最新；关闭窗口后主界面仍可操作 |
| Mac 冷启动 | PID 69972 完整退出，再启动为 71074；18 项设置完全一致，界面显示右侧、110% 大小、60% 背景、Mecha、玻璃开启；SQLite 完整性为 ok |
| 清理与保护 | QA 和回环服务器均退出；正式应用和两个未跟踪图标目录摘要保持不变 |

原生复测复用上一轮同源 QA B 包，未重新打包：实际运行二进制与构建产物 SHA-256 均为 `6ca9d30d57265f88a16a2d0916169a1a704931bee524d3c401a8abc0b7135bc7`，包来源及摘要见下文历史记录。使用独立 `app.codexmonitor.updater-test.local`、空 `CODEX_HOME` 和合成额度，不读取真实账号。`before-native.json`、`after-cold-start.json`、`cleanup.json` 记录本轮摘要、配置和进程证据；前后端结果 JSON 及各命令日志保留在证据目录。取证脚本在应用退出时两次无法以 SQLite `mode=ro` 打开文件，运行期间同路径只读检查成功，未将取证失败记为产品故障或掩盖为通过。

本轮没有重复安装升级 A→B、逐档拖动、纯鼠标悬停/穿透、菜单栏目视、真实账号、Windows/Intel、双屏/DPI、全屏及睡眠实测；上一轮证据与本轮复测分开记录。前端没有覆盖率百分比报告，更新路由及原生命令映射缺少独立前端单测，本轮仅补以实际打开更新窗口及查询结果作为局部原生证据。两个 ignored 的原因同下文，GitHub 正式密钥及审核配置未核验，不能据此宣布正式发布就绪。

## 历史记录：main 合入功能分支

结论：合并后的自动检查与本轮 Mac arm64 原生工具回归通过，未发现新增回归；Windows、Intel、真实账号及人工悬停等未覆盖项单列在末尾，不据此宣称所有平台全部通过。

## 范围与版本

- 日期：2026-10-13，Asia/Shanghai；当前分支 `codex/side-dock-analysis`。
- 先提交在线升级实现：`d7ae2c2f803b0797fc0bf49b108b34614c099b8a`，43 文件，未推送。
- 实际 fetch 的远程 `main`：`9f769559b669c289a0c59a7fc3810c9f818a463e`，相对共同基线新增 18 个提交。
- 本轮将 main 合入当前功能分支，保留其 1.3.1 版本；没有为发布额外升版，也不推送、配置 GitHub 或发布。
- 两个既有图标候选目录保持未跟踪且不纳入提交。测试使用独立 QA 标识、空 `CODEX_HOME`、合成额度；不读取真实账号或会话。

## 合并处理

main 带来 Mecha Light 皮肤、悬浮窗整体透明度和 Fast 请求证据恢复。分支保留侧边栏、账户统计、毛玻璃、动画、缩放与在线更新。

六处冲突分别位于 `README.md`、`src/App.tsx`、`src/App.test.tsx`、`src/lib/bridge.ts`、`src-tauri/src/lib.rs`、`src-tauri/src/models.rs`，逐项合并两侧行为：

- 使用共享偏好归一化，保留 18 个持久化字段、四套皮肤和更新开关；兼容旧偏好及备份恢复。
- 悬浮窗的整体透明度仅在 floating 模式应用，切入 sidebar 时清理该效果；侧边栏底色透明度、玻璃和缩放继续独立生效。
- 保留分支的偏好保存序列和事件保护；用 Fragment 保持主分支要求的根节点结构，不额外包裹视觉层。
- 侧边栏的悬浮皮肤选项补入 Mecha Light。Fast 生产逻辑保留 main，额外测试更新暂停期间不得写统计、恢复后继续提交 Fast 证据。
- README 同时保留 Mecha 的已知视觉/可访问性边界与侧边栏说明；发布流程说明同步到当前合并版本。

## 子智能体检查

三个 GPT-6.1 SOL 子智能体分别负责前端、Rust、独立集成/发布复审；主智能体复核改动并负责原生验收。日志目录：`outputs/main-merge-validation-20261013/`。

| 项目 | 实际结果 | 证据与边界 |
| --- | --- | --- |
| 前端 Vitest | 25 文件、405 项通过 | `frontend-test.log`；含四皮肤透明度、模式切换、侧边偏好与更新开关共存 |
| TypeScript/Vite 构建 | 通过 | `frontend-build.log` |
| Rust all-targets | 206 项通过、2 项忽略；验签示例另 1 项通过 | `backend-test.log`；忽略项为崩溃子进程 helper 和 1GiB 性能测试；父测试会调用前者 |
| Rust fmt、Clippy `-D warnings` | 通过 | `backend-fmt.log`、`backend-clippy.log` |
| 发布签名/清单回归 | 26/26 通过 | `release-node-tests.log`，包含真实测试签名与成熟 verifier |
| 更新策略与版本/锁文件 | 通过 | `release-policy.log`、`release-version-locks.log`；六处版本 1.3.1 一致 |
| 独立源码复审 | 无新增可证实 P1/P2 | `release-integration-review.log`；不替代原生平台验收 |
| npm 依赖审计 | 0 项漏洞 | `npm-audit.log`；未安装或修改全局环境 |
| Mac 原生 | 本轮场景通过 | 从合并前 A 升级到合并后 B；详见下表，均使用原生 CUA 界面操作 |

前端首次运行的 8 项失败来自异步保存事件时序与根节点断言，首次构建还发现旧测试夹具缺少 `opacityPercent`。修正合并兼容和夹具后，全量重跑通过；初始日志保留，不把失败隐藏为从未发生。

## 主智能体原生验收

环境：macOS 27.0.1（26A434）arm64，Node 22.23.3、Rust 1.99.0。`native-build.log` 记录实际 app/DMG 构建成功；QA 使用 ad-hoc 签名，未公证。`MAC-QA-ARTIFACTS.json` 记录 A/B 包摘要。

| 场景 | 实际结果 | 证据及限制 |
| --- | --- | --- |
| A → B 下载、验签、安装 | 通过 | 旧 A PID 30291 自动重启为 B PID 30803；重新绑定工具前已核验 B 版本与二进制摘要 |
| 旧偏好及数据库兼容 | 通过 | 17 项旧设置逐项保留，新增 `opacityPercent=100`；旧表和记录数保留，新增 `fast_request_evidence`，integrity_check=ok；数据库为隔离合成状态 |
| Mecha Light 与原有统计入口 | 通过 | 从侧边栏选择 Mecha，切到悬浮窗实际显示；总览、按模型、额度周三个页签可切换并显示合适的空数据状态 |
| 侧边栏、详情和设置切换 | 通过 | Mecha 悬浮窗可切回侧边栏；Codex、DeepSeek 详情及设置可打开；缺账户和未登录提示明确；没有真实登录 |
| 缩放、底色透明度、玻璃开关 | 通过 | 原生点击/键盘将缩放调整为 110%、底色透明度为 60%，玻璃关闭再开启；未用本次离散操作冒充连续拖动或动画帧验收 |
| 方向与齿轮 | 通过 | 右→左→顶部→右完成；顶部横向布局实际截图核对；再次点齿轮只关闭设置，保持展开的栏体仍在 |
| 完整退出后冷启动 | 通过 | 确认 30803 退出，再通过 `start` 启动新 PID 35321；18 项设置完全相等，原生设置显示 Mecha/110%/60%/玻璃开启/自动检查关闭；版本 0.0.2、手动检查返回最新，SQLite 完整 |
| 清理与范围保护 | 通过 | 原生退出 QA，停止回环服务器；正式应用 SHA 与验收前一致，12 个无关图标文件摘要不变 |

证据文件位于输出目录：`before-native-upgrade.json`、`after-native-upgrade.json`、`before-native-cold-start.json`、`after-native-cold-start.json`、`cleanup.json`。`qa-origin.json` 说明旧 A 与合并 B 的来源。截图只由工具观察合成界面，没有采集真实账户截图。

## 原生与平台边界

Mac 使用 `app.codexmonitor.updater-test.local`，A 为已验收分支的 0.0.1 包，B 为本轮合并代码构建的 0.0.2 包；两者使用同一独立测试签名密钥，与正式版本 1.3.1 分开。启动器脱离终端会话；安装前后先从进程取证，再绑定原生工具，避免工具额外启动影响结论。

Windows 11 x64、Mac Intel、双屏/DPI、全屏 Space、睡眠及真实账号读取不在本次 Mac 工具验证中完成。原生工具点击不替代后台纯鼠标悬停、连续拖动、动画及穿透的人工验收；悬浮整体透明度各档位与四皮肤的覆盖来自自动测试，未把它们记为全部原生逐档通过。Fast 的合成 SQLite 回归不是对用户真实会话的实测。此前 [在线升级验收](ONLINE-UPDATE-VALIDATION.md) 记录属于合并前版本，不能替代本报告。

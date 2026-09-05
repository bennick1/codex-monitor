# Token 统计 UI 接入报告（Step 4）

日期：2026-09-05，macOS arm64。本轮已实现真实悬停面板，并在本机 release `.app` 中观察到四项 Token；完整全屏交互验收仍待人工确认。

## 实际基线与范围

- 开始时 `main`，工作区干净，HEAD `70cfaf64e770236bc59b260766cfb1d46cecf808`，比本地 origin/main 多 6 个提交。只读 `git ls-remote` 确认远端 main 仍为 `458570229c7a3ebe4b347a5ffc349cf39391bbe5`。
- 沿用本地 Step 3 `8a46829`、付费清理 `11e7c7e`、全屏 R1 `884ec79`、R2 `13a051a` 及其报告提交；没有 reset、重新克隆、覆盖未提交修改或回退远端。
- 实现提交：`9384e0cf1131543c1178daa0d7d5e08d3e00ed8f`。本报告另行提交，沿用 main → origin/main 的普通提交/推送流程。
- 本轮用户已确认此前付费入口清理与全屏修复有效；旧报告中的“R2 待复验”是历史状态。该确认不冒充本轮加高窗口后的独立全屏验证。

| 变更文件 | 用途 |
| --- | --- |
| `src/App.tsx`、`src/components/QuotaCard.tsx`、`src/components/TokenUsage.tsx`、`src/styles.css` | 实际挂载 Token 区域、手动刷新隔离、双主题双语言展示、启动尺寸同步 |
| `src/hooks/useTokenStatistics.ts`、`src/lib/tokenStatisticsController.ts` | 稳定生命周期、单请求协调、事件合并、展开期间低频查询 |
| `src/lib/tokenFormat.ts`、`src/lib/tokenStatistics.ts` | BigInt 格式化与来源键类型 |
| `src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json` | 展开高度、拖动/边界/主题尺寸同步 |
| `src-tauri/src/token_stats/aggregate.rs`、`service.rs`、`tests.rs` | 将已有不透明来源键加入返回/事件契约，增加 IPC 断言 |
| `src/App.test.tsx`、`src/components/TokenUsage.test.tsx`、`src/hooks/useTokenStatistics.test.tsx`、`src/lib/tokenFormat.test.ts`、`src/test/tokenFixtures.ts`、`src/test/tokenLayout.tsx`、`scripts/test-token-layout.mjs` | 合成数据、组件/竞态回归和真实排版测试 |

没有改变 Token 解析、自然日/周/月算法、数据库结构、quota 认证、应用正式标识、更新地址、依赖或全屏窗口策略。没有第二个窗口、置前循环或模拟点击保活代码。

## 数据路径与状态

`get_token_statistics` → 现有 `bridge.getTokenStatistics` → `useTokenStatistics` / controller → App → QuotaCard → TokenUsage。四格只取同一响应的 `today/thisWeek/thisMonth/total.totalTokens`，不相加其他维度。完整整数与缩写运算均使用 BigInt；零值、null、缺失和失败分开处理，精确整数提示位于原面板内部，支持指针与键盘焦点，不扩大窗口或接管指针。

- 先监听 `token-statistics-updated` 再首次查询；注册期间事件不丢失。稳定 Hook 不随 Hover 重新注册；异步注册迟到会释放，StrictMode 清理后响应不会写回。
- Hover 先走既有展开流程，不等待 Token 查询/扫描。每次展开查询当前 Q；事件按 500 ms 合并、同时最多一个查询、保留一次后续需求，旧生命周期、旧来源和低 generation 响应不能覆盖当前结果。
- 展开期间每 60 秒查询；即使 generation 不变也接受新的期间边界。收起后停止展示定时器，事件只使缓存待刷新，下次展开重新查询。
- Hover 不调用扫描刷新。既有手动刷新才分别调用 quota 与 `refresh_token_statistics`；两个数据源分别处理失败。
- 使用全局 status、`isStale`、每项 `isPartial`；partial 保留可确认字段，scanning 保留已确认值并提示扫描，首次未确认扫描零值结合 `lastSuccessAt` / `factCount` 显示占位。empty 提示暂无本机记录，unavailable 不伪造零。失败保留同来源结果并提示“暂未更新”。
- 原契约没有来源身份，无法安全区分不同 CODEX_HOME 的旧值。因此仅增加 `sourceId: string | null`，复用后端已有的来源摘要；不返回路径、不增加数据库字段。来源变更事件立即清除旧快照，随后只接受该来源响应。
- 显示“本机 Codex 已采集用量”。时间使用 `lastSuccessAt`，缺失时使用 `lastScanAt`；从不把 `queryAtUtc` 当采集时间。桌面使用真实接口，失败不回退合成统计。

## 尺寸与实机发现

折叠可见尺寸仍为 72×72，原生窗口含四周 4 px 安全边距为 80×80。宽度保持可见 306 / 原生 314；展开高度调整为可见 **506** / 原生 **514**。

原 306 高度已被额度与重置信息占满。初版逐行横排在英文长标签和大整数下发生重叠，排版测试实际发现后改为每格标签在上、数值在下的 2×2，数值 18 px，说明 12 px。高度包含独立状态、范围和采集时间所需空间；没有压小字体或增宽。

Rust 展开、收起、拖动结束、主题切换尺寸及工作区边界检查均同步。原 macOS `macos_widget.rs` 与 `Info.plist` 零差异，继续保留 Accessory / LSUIElement、原 Space 标志及原显示策略。

真实重启发现：退出时保存了展开尺寸，React 重启为球体时仍有大块透明占位。最小修正为首次偏好加载后同步收起尺寸；若用户已经 Hover 则不覆盖其操作。实测保存 314×514 状态后重启，最终窗口恢复 80×80。该修正包含启动和首次 Hover 竞态测试。

## 验证结果

| 验证 | 结果与边界 |
| --- | --- |
| `npm test` | **74 passed / 11 files**。含实际 App Hover 挂载、字段对应、0/null/大整数/缩写边界、全部状态、quota 隔离、事件密集、异步注册、旧响应/来源切换、StrictMode、卸载、同 generation 期间变化、跟随系统和启动尺寸竞态 |
| `npm run build` | **通过**，TypeScript 与 Vite；最终 app 构建再次执行 |
| 合成页面真实排版 | **80/80 通过**。Chromium 实际布局覆盖中英文×浅深色×5 Token 状态×4 quota 状态，使用极大值、partial/stale 长文案，检查文字/父容器/区域边界及相互重叠。包含 reduced motion；不是原生桌面验收替代品 |
| Rust `cargo test --locked` | **53 passed，2 ignored**。包含非正方形展开工作区边界与来源键 IPC 断言；忽略的是原有崩溃辅助入口及 1 GiB 性能专项 |
| `cargo clippy --all-targets --locked -- -D warnings` | **通过** |
| `git diff --check` | **通过**；未重排全库已有 Rust 格式问题 |
| 真实 release `.app` | **已验证显示四项 Token**。图形工具进入球体后面板展开；初次与最终构建均观察到真实数值、partial 提示与采集时间 |
| 四项数值 | 同一次完整 AX 读取中，四个由后端快照直接提供的精确整数辅助文本，与对应可见缩写逐项 BigInt 核对，**4/4 一致**。契约字段映射另有组件和 Rust IPC 合成回归；未另行捕获原生 WebView 的 IPC 网络响应 |
| 后台更新 / 扫描 | 同一进程内观察到四项变化，无需重启；最终构建显示过“扫描中 · 统计不完整”，随后状态/数值更新且按钮可操作。也观察到 quota 网络失败后独立恢复，Token 区域一直存在 |
| 展开内操作 / 收起 | 实机卡片内操作、重复展开、后续恢复球体均已观察。工具以坐标点击进入球体，缺少纯鼠标悬停/移出 API；无点击的 Hover 路径与精确移出时序仍需人工，自动测试确认既有 180 ms 延时 |
| 置顶 / 保持展开 / 拖动 / 重启 | 置顶与保持展开切换有实际 AX 状态证据并恢复默认；拖动操作后卡片继续可用；重启实际验证了球体尺寸和重新显示四项。边缘吸附、各显示器位置恢复未完整实测 |
| 付费清理回归 | 源码、旧 URL/旧偏好自动回归通过；实际展开面板无付费/赞赏入口。托盘菜单实际遍历未执行，不以源码检查替代该项 |
| ChatGPT/Codex 原生全屏 | **本轮待人工复验**。图形工具明确返回禁止操作 `com.openai.codex`；未绕过。此前修复按用户确认保留，不宣称本轮独立通过 |
| 托盘锁定/解锁、隐藏/显示、吸附、全屏继续输入、睡眠唤醒 | **待人工验收**；没有停止 ChatGPT/Codex 或其他应用 |
| Windows | **未编译、未实机验证**；没有双平台验收结论 |

所有自动测试使用人工合成数据，未复制真实会话或数据库到测试目录；仓库不包含真实用量数值、会话、账号信息或截图。排版测试的合成截图/结果位于忽略目录 `outputs/token-ui-layout/`。

## 本机产物与复验

- 固定本机包：`/Users/bennick/Work/Codex/codex-monitor/outputs/token-statistics-ui-step4/Quota Float.app`。
- 对应实现代码：`9384e0cf1131543c1178daa0d7d5e08d3e00ed8f`；构建与该提交代码相同，报告提交不改变应用代码。来源清单位于同目录 `build-origin.json`。
- 可执行文件 SHA256：`4c1e792fd4de9f22f76c8cddb1543731cf148e0c0c003f89a19ed127312c034e`。最终重启 PID **88282**，`ps` 与 `lsof` 均确认上述固定副本的实际路径；之前的中间构建已退出并替换，不由旧单实例拦截。
- 独立 QA identifier：`app.quotafloat.token-ui-qa-20260905`，版本沿用 0.2.4，`LSUIElement=true`。只在命令行关闭 updater 制品和签名；未安装上游更新、打 tag、发布 Release 或新增更新服务。
- QA 运行配置/缓存/WebKit 单独映射到 `/private/tmp/codex-monitor-token-ui-qa-20260905/`，统计由真实采集器生成，未删除/复制原应用统计库。此临时数据不是自动化测试夹具，也不是正式持久化目录。
- 日志：`/private/tmp/codex-monitor-step4-{frontend,frontend-build,rust,clippy,app}.log`。本轮构建命令：

```sh
PATH=/private/tmp/codex-monitor-cargo/bin:$PATH \
CARGO_HOME=/private/tmp/codex-monitor-cargo \
RUSTUP_HOME=/private/tmp/codex-monitor-rustup \
node_modules/.bin/tauri build --bundles app --no-sign \
  --config '{"identifier":"app.quotafloat.token-ui-qa-20260905","bundle":{"createUpdaterArtifacts":false}}'
```

人工复验请使用该固定副本，检查目标应用原生全屏中的纯 Hover、进入面板、离开收起及继续输入，再检查托盘锁定/隐藏/恢复与屏幕边缘吸附。上述未验证项未收到本轮人工结果前不标为通过。

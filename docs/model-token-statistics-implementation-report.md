# Codex Monitor v1.1.0 按模型 Token 统计实施报告

## 2026-09-09 approved model-period adjustment

Execution baseline: `92660889ebdc78f5cd73dd9ae1f702d9df2030ff`; feature commit: `6598809a53b8b992b5612a8f8d17de2b5ddb4738`; branch: `codex/model-rolling-periods`. Work was isolated from the original workspace and its uncommitted files. No push was performed.

Current By Model API is `today / quotaPeriod / last7Days / last30Days / total`; this section supersedes the previous period definitions in the historical implementation notes below.

| Period | Boundary |
| --- | --- |
| today | Earliest valid local midnight using system IANA timezone, through Q exclusive |
| quotaPeriod | ProviderSnapshot.weeklyWindow.resetsAt minus windowSeconds, through Q exclusive; require windowSeconds = 604800 and start <= Q < reset; otherwise null, no fallback |
| last7Days | [Q - 604800 seconds, Q), exact UTC duration |
| last30Days | [Q - 2592000 seconds, Q), exact UTC duration |
| total | Existing active persisted facts, unchanged future exclusion and time-status rules |

All model periods share Q and the existing SQLite transaction. Overview remains `today / thisWeek / thisMonth / total` with unchanged local calendar boundaries. Decimal strings, input + output accounting, unknown remainder, ordering and overflow protection are unchanged. The existing quotaWeek boundary helper keeps its filename because it still validates the provider's weekly window; no extra query, listener, refresh state machine or network request was introduced. The user additionally approved only the one-line `service.rs` stale-result field rename.

UI: `今日 / 额度周期 / 近7天 / 近30天 / 总计`; English: `Today / Quota Period / 7 Days / 30 Days / Total`. First entry defaults to quotaPeriod. At 306px, the full labels fit in both languages and Light/Dark; browser geometry checks, screenshots, long-slug ellipsis, internal list scrolling and focus exact-value visibility passed using synthetic data. This is local component/browser validation, not final installer human acceptance.

Validation: npm ci passed with a temporary npm cache; Vitest 4.1.11, 99 tests / 12 files passed; build and updater policy passed; full and production npm audits each reported 0 vulnerabilities. Rust: 69 passed, 2 pre-existing ignored helper/performance tests; fmt and clippy with -D warnings passed. Dedicated coverage includes nanosecond half-open boundaries, spring/fall DST, Monday/month transitions, empty/huge totals, unknown and per-period reconciliation. Protected files, schema 2 and dependency manifests are unchanged.

Real-data validation used the production aggregator and a read-only database connection, freezing one SQLite snapshot in memory. With the previously captured Provider window and its recorded queryAt, all five model sums reconciled. All non-model Snapshot fields and the renamed quota period exactly matched the start-SHA implementation on that same frozen data. A current system-time query separately reconciled today, last7Days, last30Days and total; quotaPeriod correctly stayed null because no fresh Provider snapshot was supplied. Both rolling totals differed from the respective calendar week/month totals. Database integrity and schema 2 checks passed. No real counts, model usage, quota values or reset timestamps are recorded here. The historical replay does not establish current live quota availability.

Release state: **Feature Adjustment Ready for Release Preparation**. Previous source, workflow and installers are superseded as documented in the Release Validation Report. No Tag, GitHub Release, new release build source or official candidate was created. Enter another Release Preparation only after explicit user approval.

## Historical implementation notes

## Git 与版本

- 本次额度周修订起点：`f31af02ab6e56345a7c492c5caa000a367be8c92`。
- 继续使用 `feat/model-token-statistics`，推送目标为 `origin/feat/model-token-statistics`。
- 起点已有 attribution、reader、store、tests 四个未提交文件；保留已有模型归属与历史 metadata repair 改动。本次额度周修订未进一步修改归属规则，也未重算 Token facts。
- 保持 `1.1.0` 开发版本；不合并 main，不创建 tag、Release 或上传安装包。
- 本次交付仍待真实额度周及下一轮 v1.1.0 验收，不代表发布通过。

## 修改文件

- 版本：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 后端：`src-tauri/src/token_stats/{mod,model,parser,normalize,reader,store,aggregate,attribution,tests}.rs`，新增 `model_schema.sql`。
- 前端：`src/lib/tokenStatistics.ts`、`src/components/TokenUsage.tsx`、`src/components/TokenUsage.test.tsx`、`src/test/tokenFixtures.ts`、`src/styles.css`。
- 文档：本报告。

## SQLite migration 与历史回填

schema version 从 1 升为 2，accounting parser/rule version 保持 1。采用独立归属表，避免改变 V1 Token fact 数据与 JSON 身份证据：

- `model_turns`：root/thread/turn → 原始 nullable model slug，记录冲突。
- `model_identities`：原 response/legacy identity → thread/nullable turn，记录冲突。
- `model_checkpoints`：每个 source file 独立的模型读取 offset/context。
- `model_fact_lookup`：原 identity 表上的查询索引。

现有数据库在 application_id、schema/parser 兼容性、quick_check 和外键完整性检查后，以 `BEGIN IMMEDIATE` 事务完成新增表、索引及 user_version 变更。失败回滚全部迁移。fresh install 在同一创建事务中完成 V1 基础表与模型 schema。保留原文件路径安全策略、权限、WAL 与 FULL synchronous 策略。

`token_facts`、fact identity、active、用量字段、time status、reconciliation 与原 source offset 不迁移、不重算、不删除。V1 原始 schema 文件保留作为兼容基线。

回填复用 Collector 已验证的源句柄、限长分批 reader 和完整性检查，但使用独立 checkpoint；仅调用模型归属处理，不把旧记录重新送入 normalization。重复执行读取已提交的模型进度。缺失的旧 source 不删除事实，未取得模型证据的历史进入 unknown。已取得的归属随 SQLite 持久保存。

## Model attribution

- 模型只来自 `turn_context.payload.model`，turn 来自同一 payload 的 `turn_id`，thread 来自结构化 session metadata。原始 slug 保留；缺失、无效类型、空值、异常控制字符等不可用字段按无模型处理，不影响原 Token 解析。
- Modern 使用 `token_usage_record.payload.thread_id`、`turn_id`、`response_id`，通过现有 response identity 关联；不使用上一条上下文的模型代替缺失 turn。
- Legacy 仅关联已持久化 legacy fact 的精确 source range，要求 thread/当前 turn 明确且无冲突；仅当 timeUncertain 累积差值的两端均有同一连续明确 turn 证据且五项差值逐值匹配时复用既有归属；跨 turn 或证据不足仍为 unknown。缺失 turn、任务开始/完成/中止边界或解析问题清除当前模型关联上下文。
- 同一 thread/turn 出现不同明确模型，或同一 identity 的 thread/turn 冲突，归入 unknown；不猜测合并 slug。缺失模型允许后续明确结构化证据补充，已记录冲突保持保守。
- unknown 是合法结果，不额外引入错误状态。

## 最终返回结构

继续复用 `get_token_statistics`、`refresh_token_statistics`、`token-statistics-updated`。原 Snapshot 字段保留，`schemaVersion` 为 2，新增字段类型如下：

```ts
type TokenPeriod = "today" | "thisWeek" | "thisMonth" | "total";
interface ModelTokenUsage {
  model: string;
  tokens: string; // exact decimal integer
  share: number; // Token percentage, rounded to one decimal
}
interface ModelTokenPeriod {
  totalTokens: string;
  models: ModelTokenUsage[];
}
interface ModelTokenStatistics {
  periods: {
    today: ModelTokenPeriod;
    quotaWeek: ModelTokenPeriod | null;
    thisMonth: ModelTokenPeriod;
    total: ModelTokenPeriod;
  };
}
// TokenStatisticsSnapshot.modelStatistics: ModelTokenStatistics | null
```

可用的空周期返回 `{ "totalTokens": "0", "models": [] }`；unavailable Snapshot 的 `modelStatistics` 为 null。UI 与原 Snapshot 共用 scanning、partial、empty、unavailable、stale 和更新时间语义，无第二套刷新或状态机。

## 聚合与一致性

模型聚合附加在原 aggregate.rs 的同一 SQLite snapshot、同一 active fact 循环、同一查询时间和时区边界中。总览保留原今日、本周一、本月一日边界及 future-deferred 排除规则；按模型的周周期独立使用额度周边界。模型查询使用标量子查询，不使原事实行倍增。

`tokens` 仍为 input + output 的原 total 口径；cached/reasoning 不重复累加。每周期已知模型累加后，unknown = 原总量 − 已知模型之和。正数已知模型按 Token 降序、slug 打破同值排序；正数 unknown 永远最后；零行省略。

share 通过 i128 整数运算完成比率四舍五入，仅最终有界百分比转换为浮点数；Token 值不转 JavaScript Number。不人为调整显示百分比使其合计 100%。

总览保持 Today / This Week / This Month / Total（`today / thisWeek / thisMonth / total`），自然周仍为本周一当地时间 00:00 至 Q。

按模型使用 Today / Quota Week / Month / Total（`today / quotaWeek / thisMonth / total`）。今日、本月、总计与各自总览相等；额度周只与自身模型合计比较，不再要求等于总览自然周。

```text
Σ model tokens = modelStatistics.periods[period].totalTokens
Quota Week = current weeklyWindow reset boundary - one complete weekly window → query time
```

现有 `ProviderSnapshot.weeklyWindow.resetsAt / windowSeconds` 经 App → hook/controller → `get_token_statistics({ quotaWindow })` 传入聚合。窗口必须为 604800 秒；Rust 以 RFC3339 reset 减去 windowSeconds 得到起点，并以同一个 Q 校验 `start <= Q < reset`。事实范围为 `[start, Q)`，仅计入既有 dated active facts；undated/timeUncertain 保持原统计语义。

Quota 可用性共用现有卡片策略：ok 或 30 分钟内的 stale。窗口缺失、reset 缺失/非法/过期、非七天窗口、起点晚于 Q、Quota unavailable/signed_out/loading 或 stale 超时，均返回 `quotaWeek: null`，没有自然周 fallback。额度边界更新立即清除旧 quotaWeek 并重新查询；旧边界请求响应丢弃。到 reset 或 stale 截止时间失效，不推算下一周期。SQLite 查询失败时后端保留其他旧周期并清空 quotaWeek。

无新 Quota API/client、Collector、SQLite、后台扫描器或持久化 reset 状态；Token Statistics 内部只接收边界，不依赖 quota client。

Synthetic 边界测试：reset 为 `2026-09-11T09:09:19+08:00`，起点为 `2026-09-04T09:09:19+08:00`。构造 Fri/Sat/Sun/Mon 四条各 100 Token，额度周为 400，周一自然周为 100；起点前事件及 Q 当下/之后事件不计入额度周。另验证多模型、codex-auto-review、unknown share、零用量及无效边界。

## UI

Token 区域增加轻量“总览 / 按模型”切换，默认总览；原四格、万/亿、精确数字 hover/focus、partial 标记和 metadata 保留。首次进入按模型默认按额度周，支持今日 / 按额度周 / 本月 / 总计。只显示原始模型 slug、Token 和一位小数占比。unknown 中文为“未识别模型”，英文为“Unidentified”。

复用原 formatter。长名称省略显示并保留完整名称，列表最大 88px，约四行后内部滚动；状态内容较多时列表可缩小，不增加卡片宽高。synthetic Chrome 检查确认原 306px 卡宽、长模型名、多模型、超大值、双语和暗色状态组合无横向溢出或 metadata 裁切。

## 本次自动验证结果

| 检查 | 实际结果 |
| --- | --- |
| npm run check:updater-policy | 通过 |
| npm test | 97 通过，12 个文件 |
| npm run build | 通过，TypeScript + Vite |
| cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check | 通过 |
| cargo test --manifest-path src-tauri/Cargo.toml --locked | 66 通过、0 失败、2 个既有 ignored helper/performance 项 |
| cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings | 通过，零警告 |
| git diff --check | 通过 |
| synthetic 浏览器布局 | 中英文、浅色/暗色、长 slug、多模型滚动和超大整数通过；卡宽仍 306px |

原 V1 SQLite migration、历史模型 backfill/repair、归属及总量测试继续通过。新增测试覆盖额度周边界、自然周分离、Q 排除、无效窗口、模型总和、unknown、Auto Review 和零值；前端覆盖默认周期、双语、其余周期、formatter、stale 截止、reset 到期和旧请求竞态。

## 本次本机实际验证

额度周真实数据验收：未通过（缺少可读取的精确 ProviderSnapshot 边界，并非已证实计算错误）。

本机 SQLite 通过只读连接创建内存一致副本，固定 Q 对比修订前 HEAD 与当前 aggregate 的四个总览对象，逐字段一致；当前可用模型周期合计及 unknown share 有限性检查通过。未写入原数据库。

已读取现有本机应用额度界面，但 release WebView 不提供可用的快照检查入口，界面 reset 只显示到分钟，不能用于精确额度周期核对。没有从 rollout 猜 reset，也没有创建第二套额度客户端或直接请求额度接口。真实额度周与自然周差异、额度周各模型合计及 unknown 比例，仍需下一轮通过实际应用精确快照完成。

本轮 synthetic 浏览器证据不能替代 macOS 原生全屏/Spaces、Windows 或真实额度周期验收；当前运行的旧 bundle 也不能作为本次新代码实机通过的证明。

真实数据、reset、额度剩余值、Token 数、模型占比及截图未进入本报告或 Git。

## 已知限制与回归边界

- 删除日志、旧格式、缺少结构化关联或冲突产生 unknown，覆盖率不承诺达到 100%；不采用模型推断。
- 首次模型回填需要额外读取既有日志；以后按独立 offset 增量读取，空闲不重扫模型数据。
- Token 累加仍沿用原后端 i64 溢出保护，不扩展总量数值范围；传输和前端保持 decimal string。
- 原生窗口/Quota 实现未改动，现有相关自动测试通过。本次未将运行中的旧 bundle 视为新代码 Quota 实机回归证据。
- 本次未逐项重做 Windows、macOS 全屏/多 Spaces、拖动、tray、焦点行为的完整人工矩阵；上述平台验收不由局部 UI/自动测试替代。
- 本次开发和自动验证完成，真实额度周验收尚未完成，尚未发布 v1.1.0；签名、公证、安装包发布及最终发布验收留待单独授权。

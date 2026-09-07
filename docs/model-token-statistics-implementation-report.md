# Codex Monitor v1.1.0 按模型 Token 统计实施报告

## Git 与版本

- 起始 commit：`d4ed050a6b4c52e562df482b1d724291f54e3161`，开始时工作区干净，本地 main 与刷新后的 origin/main 一致。
- 最终功能 commit：`43ba8023c8169be8611e6f8a200aa18c9096ec24`（`feat: add per-model token statistics`）。本报告随后独立提交，以记录实际功能 SHA；包含报告的交付提交可通过本文件的最新 Git 提交定位。
- 分支：`feat/model-token-statistics`，交付目标为同名 origin 分支；不合并 main。
- package、Cargo、Tauri bundle 版本同步为 `1.1.0`。
- `v1.0.0` Tag object 保持 `ca9093d74e9788f81fa61e3a7251afbe97652c18`。不创建 v1.1.0 Tag、Release 或上传安装包。

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
- Legacy 仅关联已持久化 legacy fact 的精确 source range，要求 thread/当前 turn 明确且无冲突；不归属 timeUncertain 的跨事件差值。缺失 turn、任务开始/完成/中止边界或解析问题清除当前模型关联上下文。
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
  periods: Record<TokenPeriod, ModelTokenPeriod>;
}
// TokenStatisticsSnapshot.modelStatistics: ModelTokenStatistics | null
```

可用的空周期返回 `{ "totalTokens": "0", "models": [] }`；unavailable Snapshot 的 `modelStatistics` 为 null。UI 与原 Snapshot 共用 scanning、partial、empty、unavailable、stale 和更新时间语义，无第二套刷新或状态机。

## 聚合与一致性

模型聚合附加在原 aggregate.rs 的同一 SQLite snapshot、同一 active fact 循环、同一查询时间和时区边界中。复用原今日、本周一、本月一日边界及 future-deferred 排除规则。模型查询使用标量子查询，不使原事实行倍增。

`tokens` 仍为 input + output 的原 total 口径；cached/reasoning 不重复累加。每周期已知模型累加后，unknown = 原总量 − 已知模型之和。正数已知模型按 Token 降序、slug 打破同值排序；正数 unknown 永远最后；零行省略。

share 通过 i128 整数运算完成比率四舍五入，仅最终有界百分比转换为浮点数；Token 值不转 JavaScript Number。不人为调整显示百分比使其合计 100%。

四个周期均验证：

```text
Σ model tokens = modelStatistics.periods[period].totalTokens
               = overview[period].totalTokens
```

既有测试 Harness 的每次 Snapshot 查询也检查四周期不变量，覆盖原时区、DST、自然周/月、future、undated、timeUncertain、去重和 reconciliation 场景。

## UI

Token 区域增加轻量“总览 / 按模型”切换，默认总览；原四格、万/亿、精确数字 hover/focus、partial 标记和 metadata 保留。首次进入按模型默认本周，支持四周期。只显示原始模型 slug、Token 和一位小数占比。unknown 中文为“未归属”，英文为“Unknown”。

复用原 formatter。长名称省略显示并保留完整名称，列表最大 88px，约四行后内部滚动；状态内容较多时列表可缩小，不增加卡片宽高。synthetic Chrome 检查确认原 306px 卡宽、长模型名、多模型、超大值、双语和暗色状态组合无横向溢出或 metadata 裁切。

## 自动验证结果

| 检查 | 实际结果 |
| --- | --- |
| npm ci | 通过；默认 cache 写权限失败后改用临时 cache，165 packages，0 vulnerabilities；未变更依赖版本 |
| npm run check:updater-policy | 通过 |
| npm test | 92 通过，11 个文件；TokenUsage 25 项，其中新增 10 项 |
| npm run build | 通过，TypeScript + Vite |
| cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check | 通过 |
| cargo test --manifest-path src-tauri/Cargo.toml --locked | 60 通过、0 失败、2 个原有 ignored helper/performance 项；新增 7 个模型/迁移专项测试 |
| cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings | 通过，零警告 |
| git diff --check | 通过 |
| 显式 1 GiB synthetic performance test | 1 通过；约 149 秒首次扫描，10ms 空闲扫描且读取 0 字节，约 49 秒重启完整性验证；单次并发验证结果，不作为独立性能基准 |
| synthetic Chrome 模型布局 | 4 场景通过；中英、暗色、12 个长模型名、超大整数与状态组合，hover/focus 精确值可见，无 browser error |
| macOS app 构建 | 本地 app bundle 构建成功，未上传 |

专项测试覆盖 parser 原始 slug/缺失/无效 model、Modern 跨 turn 与冲突、Legacy 无泄漏、V1 migration/事务回滚/foreign application_id、缺失 source、重复回填/重启/增量、四周期排序/unknown/zero/超大整数/share/自然边界。迁移测试逐字段比较原 accounting 表以及 source offset/context。

## 本机实际验证

结果：通过。

- 真实 V1 SQLite 先创建本地在线备份，私有副本迁移和回填成功后验证实际应用。
- 实际数据库升级为 schema 2；升级前全部 Token facts 逐字段保持不变，quick_check 为 ok。
- 总览原四格正常；模型可打开，重启后首次进入默认本周；真实模型名称、四周期切换和未归属末行可见。
- 使用实际 aggregate.rs 对实际数据库核对四周期模型和总览不变量，通过。
- 正常退出并重启后已有 facts 和模型 metadata 保留；真实新增 Token 后总量及已知模型用量增长，四周期不变量继续成立。
- 已恢复总览及原自动收起设置。置顶状态保留；展开操作正常。

以上私有数据、数据库备份、真实 Snapshot、使用量及截图均未进入仓库或本报告。

## 已知限制与回归边界

- 删除日志、旧格式、缺少结构化关联或冲突产生 unknown，覆盖率不承诺达到 100%；不采用模型推断。
- 首次模型回填需要额外读取既有日志；以后按独立 offset 增量读取，空闲不重扫模型数据。
- Token 累加仍沿用原后端 i64 溢出保护，不扩展总量数值范围；传输和前端保持 decimal string。
- 原生窗口/Quota 实现未改动，现有相关自动测试通过。本机已观察原 Quota unavailable 后恢复及周额度更新；5 小时额度在本次账号响应中不可用，未伪造成功证据。
- 本次未逐项重做 Windows、macOS 全屏/多 Spaces、拖动、tray、焦点行为的完整人工矩阵；上述平台验收不由局部 UI/自动测试替代。
- 本任务完成开发与本机功能验证，尚未发布 v1.1.0；签名、公证、安装包发布及最终发布验收留待单独授权。

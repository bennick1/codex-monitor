# Codex Monitor V1.0 — Step 3 实现报告

日期：2026-09-05。事实源：[Step 1](quota-float-analysis.md)、[Step 2](token-statistics-design.md)。

开始时工作区干净，`main`、HEAD 和通过 `git ls-remote` 核验的 `origin/main` 均为 `458570229c7a3ebe4b347a5ffc349cf39391bbe5`。本轮沿用 main → origin/main 流程，不回退、强推、打 tag 或发布。

## 1. 实际变更

| 文件 | 职责 |
| --- | --- |
| `src-tauri/src/token_stats/parser.rs` | 有界、白名单解析；未知正文借用后跳过；计数和 UTC 时间规范化 |
| `model.rs` | 最小事实、计数向量、来源覆盖、文件流状态和不透明身份键 |
| `normalize.rs` | response 身份、旧累计差分、连续前缀验证、候选隔离和事务纠错 |
| `schema.sql`、`store.rs` | SQLite 初始化、版本保护、事实/身份/来源/候选/检查点持久化 |
| `reader.rs` | 当前来源发现、链接检查、文件版本、流式批次、摘要核对和扫描 |
| `aggregate.rs` | 单一 Q、IANA 本地时区、数据库读事务下的四项汇总与质量契约 |
| `service.rs` | 独立单写者线程、合并触发、退避、取消、commands、通知 |
| `tests.rs` | 人工生成夹具、临时数据库、子进程中断和显式性能测试 |
| `src-tauri/src/lib.rs` | 仅增加模块、服务启动/退出、聚焦/唤醒触发和 command 注册 |
| `src/lib/tokenStatistics.ts`、`bridge.ts`、对应测试 | TypeScript 契约、独立 IPC 和事件桥接 |
| `Cargo.toml`、`Cargo.lock`、`.gitignore` | 必要依赖及本地数据库/生成文件排除 |
| `README.md`、`PRIVACY.md` | 修正“仅保存界面偏好”，披露最小元数据和删除源后的保留 |

没有改动 React 组件、CSS、窗口尺寸、皮肤、quota 解析/认证/锁、应用标识、更新地址、CI 或发布设置。没有独立 Node/Python/Web 常驻服务；Vite 只用于已有桌面开发命令。

## 2. 依赖、存储和恢复边界

- 使用 `rusqlite 0.37.0` + `bundled, backup`，实际链接 SQLite **3.50.2**。同步 API 适合单独阻塞线程；bundled 避免依赖 macOS/Windows 系统 SQLite 的安装和版本。没有引入另一套异步数据库运行时。[rusqlite 文档](https://docs.rs/rusqlite/0.37.0/rusqlite/)
- `chrono-tz 0.10.4` 提供固定 IANA 规则，`iana-time-zone 0.1.65` 每次查询读取系统时区。`same-file 1.0.6` 提供打开文件的本地身份；已有 `libc 0.2` 在 Unix 上提供 `O_NOFOLLOW | O_NONBLOCK`，防止竞态替换成链接或 FIFO。`serde_json` 增加 `raw_value`；`tempfile` 和 Tauri `test` feature 仅用于测试。现有锁文件中的旧依赖版本未升级。
- 生产数据库固定为 `app_local_data_dir/token-statistics.sqlite3`。不写 CODEX_HOME、仓库、AgentConfig 或共享知识库。Unix 新数据库权限 0600，新建目录 0700；本机实际库和 WAL 也核验为 0600。Windows 使用当前用户应用数据目录的继承权限，实机 ACL 未验证。
- `WAL`、`synchronous=FULL`、`foreign_keys=ON`、250 ms busy timeout、1000 页自动 checkpoint、`trusted_schema=OFF`。写事务为 `BEGIN IMMEDIATE`，查询为独立只读连接上的读事务，读取 WAL 的已提交状态。[SQLite PRAGMA 说明](https://www.sqlite.org/pragma.html#pragma_synchronous)
- `schemaVersion=1`、`parserVersion=1`、application id 和 checked generation 分别管理。计数字段为受检查的非负 i64；SQL 约束核对 input/output、子集和 total 上限。汇总在 Rust 中检查溢出，不使用可能转浮点的 SQL SUM。
- `source_roots/root_locators` 保存来源摘要及可恢复的配置定位关系；真实绝对路径仅在内存。`source_files` 合并文件版本、availability 和检查点；`file_chunks` 保存已提交连续区间的 SHA-256。文件 cursor 保存累计基线、序列链、格式状态、未决响应窗口；`threads` 保存父关系和已确认新格式连续性状态。
- `legacy_events` 是同 thread 连续计量流的最小前缀证据；`token_facts` 保存规范事实及 active 标志；`fact_identities` 唯一绑定 response/legacy 身份；来源引用、候选来源和 `reconciliation_links` 均独立保留。没有文件删除级联。inactive 旧事实通过替换关系区分已替代事实与不计量的诊断窗口。
- 解析和文件 IO 在事务外。提交时重新核验打开文件、原检查点、已读边界和文件版本，事务内完成事实、身份、候选、替换关系、格式状态、完整行偏移与 generation。只有 COMMIT 成功才发布新 generation；失败不会发布未提交增量。
- 文件的已观察长度在读取前单独持久化，但不推进完整行偏移。读取失败/半行后源消失，会通过 `uncommittedSourceTail` 继续报告缺口；可以重试的未处理尾部与未变化的半行分开处理。若存储连观察元数据都无法写入且进程随后终止，则不能保证恢复这一未持久化的观察，不能据此补估 Token。
- 启动检查版本、`quick_check` 和外键完整性。不支持的 schema/parser、损坏或不安全数据库路径会保留原库并报错，不覆盖为空库。已验证真实子进程退出后的 SQLite WAL 恢复。
- **没有历史 schema/parser 迁移**，没有自动删除重建、自动修复损坏库或自动回滚到旧备份。测试通过 SQLite Online Backup API 创建临时一致性副本，并验证 WAL 中的事实及已删除源历史可从副本读取；这不代表生产备份调度、损坏原库替换或历史版本迁移已经实现。没有有效副本时，损坏历史不能承诺恢复。

## 3. 支持的格式与可执行判定条件

所有身份都在当前规范化根目录和 Codex 命名空间内。hashed identity 不是加密，也不是额外身份凭证。

**R1：新格式 response。** 必须有非空、长度不超过 512 字节的 `thread_id/response_id` 和合法 `usage`。input/output/total 必须是非负 i64 整数且 input + output = total。cached/reasoning 缺失或非法时该维度为 null，主计数保留并标 partial。cache write 可选保存，不加到 total。逐 response 的 usage 是唯一新格式计量入口，thread 累计仅作证据。

相同 response 必须与已提交 thread、usage、时刻一致，才能只补来源引用；冲突保留可信事实及脱敏冲突候选。不同 response 即使用量完全相同也分别计量。子代理自己的新 response 独立计量；副本中的原 response 必须保持原 `payload.thread_id`，已知父关系只用于解释来源，不把父子累计再相加。不能解释的跨 thread 身份冲突返回 partial。

**R2：旧累计。** 按物理顺序和已核验的逻辑 thread 前缀处理。初始 C=L 才接纳零基线；C>L 只建立后续基线并记录缺失前缀。相同累计不新增；合法非负差分只接纳一次。差分=L 且没有坏行缺口才定为单次 dated/undated；否则为 timeUncertain 区间。回退/非法向量永久隔离该未证实段，不取绝对值，也不因重复 metadata、compaction 或模型变化重置。没有 response 身份的旧子代理/fork 历史保守隔离，不能承诺普遍精确的跨 fork 去重。

**R3：副本/归档前缀。** 同 thread 的旧累计序列索引、包含前后累计/last/turn/UTC 时刻的连续摘要链必须一致。重复累计通知不增加序列索引。分歧保留已确认历史并隔离分叉，不能根据 mtime 任意挑选最新流。所有源引用包含文件版本与完整行偏移。截断/重写创建新文件版本，仍查询持久化身份；未重现的旧事实不被撤销。

**R4：正向闭合衔接窗口。** 同一已核验旧流中的 C_before → 一个或多个新 response → C_after，必须同时满足：

1. 当前 thread 身份无冲突、旧段未回退，窗口中没有坏行、未知格式或未核验分叉。发生变化的旧累计边界即关闭当前物理窗口；匹配失败的候选继续落库，但不能借用后续数值相同的差分重新匹配。
2. 窗口中 response id 唯一；新记录与结束旧回显的非空 turn 关联一致。若存在 ordinal，必须保持严格递增；ordinal 本身不充当 response id。
3. 五个核心计数完整；首条新 thread 累计等于自身 usage，随后每条新累计差分等于对应 usage，形成从零开始的完整连续序列。
4. C_after − C_before 等于这段新序列的最终累计；结束旧回显的 last 等于最后一个新 response；所有已绑定 response 键均无身份/数值/时间冲突。
5. 旧窗口、候选及新规范事实都在同根事务中提交；旧窗口变 inactive，身份/来源/映射同步保存。一对一旧身份重绑到规范 response，多对一窗口通过替换 links 连接全部新事实。

缺失更早的历史不抹去已知 C_before 之后的完整窗口；缺失前缀问题仍保留。匹配依赖上述组合条件，不能单独使用相同数字、接近时间、同 turn 或相邻位置。R4 是对文档中结构的有限兼容规则，未宣称所有 Codex 内部版本都遵循这一序列。

**R5：跨重启迟到。** 先前 1000→1120 已提交后，仅追加 usage=120，无法证明它对应旧 120：保留 1120，保存 pending，不变为 1240。若后来读取的更完整别名/重写版本核验了相同旧前缀，并在相同旧窗口内提供 R4 完整序列，则原子替换已提交旧 120，总计仍为 1120。已确认旧前缀不丢失。多 response 对应旧 gap 仅在 R4 的完整覆盖下整体替换；没有该证据不按合计强拆。测试还用临时合成的已提交重复状态验证 1240→1120 的纠错和重放幂等，并不声称存在历史迁移。

**R6：切换之后。** 同一旧前缀之后的新响应必须延续保存的现代累计链；不同文件可恢复 thread 的已确认连续性状态。迟到而不能连续衔接的未知 response 仍保留 pending，不因已经处于 responseRecords 就盲目相加。一个文件的活跃候选窗口上限 256；额外候选仍落库，窗口溢出标 partial，不能丢弃候选后推进为正常状态。

真实本地联调仍观察到旧 fork、缺乏响应关联的衔接窗口、重复 metadata 身份冲突及未知格式等质量问题。当前内部字段不能普遍支持其精确映射；这些范围保留 partial。报告与仓库不包含真实用量数值、会话 ID、路径清单或原始日志。

## 4. 读取、调度与接口

- 来源仅为进程有效 CODEX_HOME 的 `sessions`、`archived_sessions`，未设置时为用户目录 `.codex`。空配置不回退。根路径解析失败通过已保存 locator 关联保留当前来源，不猜测迁移。根变更后命名空间分离。
- 目录递归最多 64 层、发现队列最多 100,000 项，防循环；只读普通 `.jsonl`。链接解析后仍须落在两个允许目录内，打开后核验文件句柄。目录不完整时不标记 missing；不可读/已删除的来源不撤销事实。
- 每文件固定打开时长度；64 KiB 缓冲，8 MiB 批预算，完整行可跨预算，16 MiB 单行上限。超大行丢弃至换行，半行不推进 committed offset。忽略事件不保留正文对象或原行。取消在读取块边界检查。
- 长度/mtime 未变化的常规轮不读取日志；变化时检查本地文件身份和首尾边界摘要；启动及距上次核验一天后检查全部已提交 chunk。完整性核对目标限速 128 MiB/s，实际速度可能更低。长度/mtime 均伪装且发生于中部的改写，允许在下次低频核验前延迟发现；测试固定 mtime 验证此路径。
- 一个 `token-statistics` 线程负责扫描和写入。15 秒正常间隔；失败独立指数退避至最多 5 分钟。手动/聚焦/唤醒共享一个布尔待处理信号，最多合并保留一次后续轮。查询只读取 SQLite，不触发文件扫描；使用 Tauri blocking pool，不占 UI 线程或 quota fetch_lock。

| 接口 | 契约 |
| --- | --- |
| `get_token_statistics()` | 无参数；固定 Q、当前 IANA 时区和同一数据库读快照，返回四项及质量 |
| `refresh_token_statistics()` | 无参数；立即返回 `{queued, scanning, generation}`，合并触发后台轮 |
| `token-statistics-updated` | `{schemaVersion, generation, scanning}`；已提交 generation/扫描状态通知，接收者重新查询取得统一 Q |

具体 TypeScript 契约在 `src/lib/tokenStatistics.ts`。token、generation 和事实/问题计数为十进制字符串；缺失指标为 null。查询不接受磁盘路径、自定义期间或未来上界。scope 固定 `localCodexHome`。

四项均截止 Q：today 为本地当日 00:00，thisWeek 为本周一，thisMonth 为月初，total 为当前来源已确认 active 事实。UTC 以纳秒格式保存；按 IANA 日历转换起点，重复午夜取最早映射，缺失午夜取首个有效时刻。期间起点=Q 合法。dated/undated/timeUncertain 为 total 的互斥组成；事件时刻或已知区间端点 >=Q 的事实列 futureDeferred，四项均排除。时间不明仅进 total，期间明确 partial，不强归今天。时区失败不偷换 UTC 日历。

状态实现 scanning、ready、empty、partial、unavailable 及独立 isStale。首次回填不冒充完整覆盖；没有证据的不可用返回 null；真正零用量和没有兼容记录区别于失败；只有未来事实/歧义候选不会返回 empty。已完成扫描的零结果和仅含未来事实的结果，在后续来源失败时也保留并标 stale。错误只使用固定代码，不向日志或前端泄露来源路径/原始内容。

## 5. 自动化验收映射

以下编号按设计第 9 节原顺序排列。测试函数均位于 `src-tauri/src/token_stats/tests.rs`。所有截断、重写、权限变更、损坏、SQLITE_FULL 和子进程强制退出只作用于带合成标记的临时目录/库。

| # | 设计验收场景 | 状态与测试证据 |
| --- | --- | --- |
| 01 | 100/40/20/5 得到 total=120 | 通过：`core_counts_do_not_add_subsets` |
| 02 | response 重播、扫描、重启 | 通过：`modern_replay_scan_restart_archive_delete_and_reimport_are_idempotent` |
| 03 | 旧 120→120→170 | 通过：`legacy_differences_repeated_metadata_and_rollbacks` |
| 04 | 同时写新旧一条请求 | 通过：`mixed_forward_bracket_keeps_legacy_prefix` |
| 05 | 旧 1000 + 新 120 + 回显 1120 | 通过：同上；最终 1120 |
| 06 | 无法证明切换 | 通过：`equal_values_turn_or_time_without_complete_sequence_do_not_match`、`unmatched_transition_cannot_reuse_a_later_equal_legacy_delta` |
| 07 | 迟到新记录，有完整映射证据 | 通过：`richer_verified_alias_replaces_committed_legacy_after_restart`；证据范围见 R5 |
| 08 | 迟到新记录，仅数字相同 | 通过：`late_response_without_evidence_remains_pending_after_deletion`；保留 1120 |
| 09 | pending 跨批次后源删除 | 通过：同上；`transition_pending_survives_batch_restart_and_legacy_only_replay`、`failed_or_partial_tail_deleted_later_remains_a_reported_gap` |
| 10 | 170→20 无清零证据 | 通过：`legacy_differences_repeated_metadata_and_rollbacks` |
| 11 | 首累计包含不可见前缀 | 通过：`first_cumulative_prefix_and_missing_response_never_backfill_guesses` |
| 12 | 重复 metadata/resume/compaction | 通过：重复 metadata 差分测试；compacted 跳过且不重置状态 |
| 13 | 主任务、子代理、fork | 通过：`equal_usage_distinct_responses_and_subagents_are_not_merged`、`response_conflicts_and_fork_legacy_prefixes_are_isolated`、`observed_child_without_usage_reports_coverage_gap` |
| 14 | 活动/归档移动、共存 | 通过：`modern_replay_scan_restart_archive_delete_and_reimport_are_idempotent` |
| 15 | 截断、替换、同长度覆盖 | 通过：`truncate_rewrite_and_same_length_edit_preserve_old_facts`、`daily_integrity_check_detects_middle_rewrite_with_unchanged_mtime` |
| 16 | 唯一源删除、重启/缓存丢弃 | 通过：重放/删除测试、重新打开数据库查询 |
| 17 | 重新导入/改变归档路径 | 通过：重放/归档测试；旧流另见 `transition_pending_survives_batch_restart_and_legacy_only_replay` |
| 18 | 权限/扫描中断 | 通过（macOS）：`safe_unicode_paths_links_permissions_and_cancelled_discovery`、`unreadable_root_preserves_namespace_and_does_not_switch_sources`、`scan_failure_retains_confirmed_empty_and_future_only_results` |
| 19 | 有证据纠错、总计可下降 | 通过：`verified_reconciliation_can_reduce_a_synthetic_duplicate_committed_state`；1240→1120、再次重扫不变 |
| 20 | 半行、CRLF、多字节跨批 | 通过：`streaming_half_line_crlf_utf8_bad_and_oversize_are_bounded` |
| 21 | null info/坏行/超大行/新字段 | 通过：同上；无效 timestamp 类型另有 `invalid_timestamp_type_keeps_confirmed_usage_undated` |
| 22 | 无用量的语音会话 | 通过：`empty_voice_session_and_privacy_whitelist`；不按时长估算 |
| 23 | 自然周跨月 | 通过：`natural_week_month_and_empty_month_boundary` |
| 24 | 月初空区间 | 通过：同上；同时覆盖跨年周起点 |
| 25 | 午夜/DST/时区变化 | 通过：`dst_timezone_changes_skipped_and_repeated_midnight`；23/25 小时日、Apia 缺失日期、Havana 重复午夜 |
| 26 | =Q 或 >Q 的未来事件 | 通过：`future_undated_and_uncertain_times_never_become_today` |
| 27 | 跨日 gap/无效 timestamp | 通过：同上及 `multi_response_complete_bracket_replaces_one_legacy_gap` |
| 28 | 可选缺失/JS 整数范围 | 通过：`optional_missing_invalid_and_integer_boundaries`；含 i64 上界和汇总溢出 |
| 29 | 扫描中查询/并发刷新/退出 | 通过（后端）：`concurrent_refresh_is_coalesced_and_queries_use_committed_generation`、IPC 测试；桌面窗口交互未完整验证 |
| 30 | 事实写入后、checkpoint 前中断 | 通过：`transaction_errors_rollback_facts_and_checkpoint_together`、子进程退出测试 |
| 31 | checkpoint SQL 后、COMMIT 前 | 通过：同上 |
| 32 | COMMIT 后、通知前 | 通过：同上；恢复已提交 generation |
| 33 | 替换中断 | 通过：`abrupt_process_exit_recovers_wal_before_after_commit_and_replacement` |
| 34 | 满盘/忙/损坏/未知版本 | 通过：`database_busy_disk_full_unknown_versions_and_corruption_preserve_files`、`collector_sqlite_full_does_not_advance_checkpoint`；SQLITE_FULL 为临时库页数上限，不填满真实磁盘 |
| 35 | parser 升级且源删除 | 不适用：首版无历史迁移；未知 parser 拒绝写入/原库保留保护已测试，不声称升级迁移通过 |
| 36 | 接近 1 GB 回填、静止轮 | 后端通过：显式 `synthetic_gib_backfill_and_idle_increment`；性能见下。完整桌面响应度测试未执行 |
| 37 | macOS/Windows Unicode、链接、占用 | macOS 文件测试通过，忙数据库已测；Windows 编译/实机占用与 junction 验证未执行 |

补充：`same_thread_legacy_fork_does_not_select_latest_mtime`、`mixed_thread_continuation_and_late_response_after_switch`、`consistent_online_backup_includes_wal_and_deleted_source_history`、`tauri_ipc_contract_uses_registered_independent_commands`。

## 6. 实际检查与性能

本机环境：Apple M1，16 GiB RAM，macOS 26.6.2（25G83），aarch64；Rust/Cargo 1.98.1，Node 22.23.1。原机器无 Rust，本轮工具链/下载缓存安装在临时目录，没有改动用户 shell 配置。所有下面的标准 Cargo 命令实际通过临时工具链路径执行。

| 命令/检查 | 结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 57 项通过（含原有 20 项）；2 项默认 ignored 分别为子进程辅助入口和显式性能场景。辅助入口由恢复测试自动启动；性能用例单独显式执行通过 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 本机 debug 编译通过；不是 Windows 编译或安装包验证 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` | 通过，保留原有 `license.rs:105` unnecessary_lazy_evaluations 警告；新增模块无警告 |
| 严格 Clippy `-- -D warnings` | 未通过；最终核验只剩原有 license 警告，没有修改授权模块或压制 lint |
| `cargo fmt ... -- --check` | 未通过：基线 lib.rs/license.rs 已有格式差异；另从 HEAD 提取 lib.rs 复现基线失败。没有整文件无关格式化 |
| `rustfmt --edition 2021 --check src-tauri/src/token_stats/*.rs` | 通过；新增模块完整格式化，lib.rs 新增接入片段按 rustfmt 形式编写 |
| `npm test` | 6 个文件、19 项通过（新增 bridge 契约 3 项） |
| `npm run build` | TypeScript + Vite 构建通过 |
| `npm audit --audit-level=high` | 未通过：此次查询报告 14 项（4 moderate、10 high），涉及已有 Browserslist/Babel、nanoid/PostCSS/Vite 链；package-lock 未变，未做无关升级 |
| `git diff --check` | 通过 |

性能用例生成 **1,074,414,849 bytes**（约 1.001 GiB），16,384 条约 64 KiB 的合成正文跳过记录、1,024 条合成 response 和 metadata；事实量与正文比例明确，不将它等同于所有真实日志的格式比例。测试构建为 **未优化 debug/test**，通过 `/usr/bin/time -l` 对测试进程测量 RSS。后台桌面其他应用未清空；不是独占硬件基准。

| 指标 | 已完成测量 |
| --- | --- |
| 回填 | 56,143 ms；日志解析读取 1,074,414,849 bytes，边界摘要读取 2,088,960 bytes |
| 静止增量轮 | 4 ms；日志读取 0 bytes，完整性读取 0 bytes |
| 重启核验 | 48,152 ms；解析重读 0 bytes，完整性读取 1,074,423,041 bytes |
| 最大常驻内存 RSS | 21,938,176 bytes（约 20.9 MiB，含测试进程） |
| 完整测试进程 | 104.68 s wall；102.62 s user、1.02 s system |

首次不提权的相同测试逻辑通过，但 `/usr/bin/time` 被沙箱拒绝读取 clockrate，未取得 RSS；上表来自最终读取与规范化代码获得资源统计权限后的实测，不补造缺失指标。逻辑读取量由 Reader 计数，**不等于物理磁盘 IO**；系统报告的 block IO 为零不能解释为没有读取。

## 7. 本地联调、隐私和未验证项

通过已有 `npm run tauri -- dev --no-watch` 启动 macOS 开发应用，核验进程 cwd 为当前 `src-tauri`；后台在实际 app_local_data_dir 初始化数据库，完成当前有效本地来源的一轮扫描，generation 和 lastSuccessAt 推进。仅用只读 SQLite 查询核对运行状态及文件权限；没有破坏、重写、截断、删除真实 Codex 源或真实统计库。开发进程在验证后停止，已确认的本地元数据保留。

桌面自动化无法按名称或开发二进制路径关联该未打包进程。因此 **本机启动/采集联调通过，完整窗口 Hover/收起/拖动及大日志下视觉响应冒烟未验证**；不能用 IPC mock、数据库状态或 Vite HTTP 成功替代这项结论。没有为此修改签名/发布配置或制作最终安装包。

隐私测试在合成正文、cwd、instructions 中放置哨兵串，核查数据库不含这些内容；响应契约不含源文件名。Collector 代码没有 auth、HTTP client、quota 引用或生产日志输出。源码仓库排除数据库、WAL/SHM/恢复后缀、真实用量、工具链和生成产物。README/PRIVACY 已披露源删除后的最小元数据保留与本机处理。

尚未验证：Windows 编译/测试、Windows 实机运行与 ACL/junction/文件占用；完整 macOS 桌面交互；全部 Codex 内部历史格式、无法提供响应关联证据的旧 fork/迟到窗口；真实账目对官方账户的完整核对；生产备份调度、损坏库自动恢复与历史版本迁移。当前阶段只读采集不能补回安装前已删除、远程、云端或未落地记录。

后端可提供 Step 4 所需独立统计契约和后台服务；这不等于跨平台或全部桌面人工验收完成。本轮停止于 Step 3，不修改 Token UI，不进入打包发布。

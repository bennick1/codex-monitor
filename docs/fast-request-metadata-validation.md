# v1.3.1 Fast 请求元数据补丁：验证与发布归档

## Final Closure（2026-10-04）

本节记录 v1.3.1 的正式发布与 docs-only 归档。**最终人工验收：Passed — 用户明确确认「人工验收通过」。** 确认对象是下列固定 Candidate 与原 CI 安装包；具体平台和场景沿用实际验收记录，不据此补写全量历史、Windows 缺少真实样本的 Fast 场景、读屏器或 WCAG 全通过。

| 项目 | 最终事实 |
| --- | --- |
| Accepted Candidate / Release Source | `0bce678f28d2123361a97d4fcdfaf1b69420fb2f` |
| 人工验收安装包来源 | [GitHub Actions Run 37084876209](https://github.com/bennick1/codex-monitor/actions/runs/37084876209)，两个原 artifact ZIP 的大小、SHA-256 和 CRC 重新核验通过。 |
| main 发布前 / 发布源码 | `58e14c488670f661406dc459fb3a2e8657f59db6` → `0bce678f28d2123361a97d4fcdfaf1b69420fb2f`；干净独立 worktree 执行 ff-only，普通 push 后经 ls-remote 与 GitHub API 独立确认。 |
| Annotated Tag | `v1.3.1`；object `0dcfaa2567ef4d373eccd10b15a1ec13127c36a8`；peeled target `0bce678f28d2123361a97d4fcdfaf1b69420fb2f`；message `Codex Monitor v1.3.1`。 |
| 正式 Release | [Codex Monitor v1.3.1](https://github.com/bennick1/codex-monitor/releases/tag/v1.3.1)；ID `403027234`；`draft=false`、`prerelease=false`。 |
| 发布时间 | `2026-10-04 21:17:31 CST`（Asia/Shanghai）；UTC `2026-10-04T13:17:31Z`。 |
| 任务出处 | `7a6333f66b0d10bf14f7f69969dafcb5a2017e6f` 的 [任务书](TASK-V1.3.1-FINAL-RELEASE-CLOSURE.md)，原文逐字节纳入本次归档；该 docs-only 任务提交不是新 Candidate。 |

正式 Release 仅含以下三份资产。两份安装包均只复制、重命名自已验收文件；原 CI ZIP 内 installer、用户验收副本与正式命名文件逐字节一致。三份正式资产已在发布后从 GitHub 回下载，大小、摘要及与发布暂存原件的逐字节比较全部通过；`SHA256SUMS` 为 UTF-8 无 BOM、LF、末尾换行，仅含两份安装包。

| Release 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `Codex-Monitor-1.3.1.dmg` | 15075069 | `5610ce3ba2719982b1ae0adf49c75c87802cdd7ab1259c23bb53ed3c4a45c012` |
| `Codex-Monitor-1.3.1.exe` | 4951618 | `e59db1cdaee1f6ab83349aed6bea541cc90cfa1cd2684da624f37215ab3f56e9` |
| `SHA256SUMS` | 180 | `f4d9101d68fdfa8f2eb2675728021d1cb6e494b7e86f2ad9bc84d142e0344466` |

| CI | Run | head_branch | 结果 |
| --- | --- | --- | --- |
| Accepted Candidate | [37084876209](https://github.com/bennick1/codex-monitor/actions/runs/37084876209) | `codex/fast-request-evidence` | Success；Frontend / macOS / Windows 均成功，Windows GUI subsystem 通过；attempt 1。 |
| main 快进 | [37203785177](https://github.com/bennick1/codex-monitor/actions/runs/37203785177) | `main` | Success；Frontend / macOS / Windows 均成功，Windows GUI subsystem 通过；attempt 1。 |
| v1.3.1 Tag | [37204598030](https://github.com/bennick1/codex-monitor/actions/runs/37204598030) | `v1.3.1` | Success；Frontend / macOS / Windows 均成功，Windows GUI subsystem 通过；attempt 1。 |

以上 Run 的 `head_sha` 均为固定 Release Source。本次记录的成功结果不将已有 readiness 时序隐患写成已修复。docs-only closure 推送后自然产生的 CI 由该提交的检查结果与发布执行回执记录；main、Tag、文档 CI 新产生的安装包均不替代 Run `37084876209` 的验收包。未运行历史 v1.1.0 专用 `release.yml`，未修改 CI、测试 timeout 或生产代码。

签名按本次实际 artifact 核验：Windows NSIS 安装包 PE certificate table 为空，未签名；macOS Universal 包包含 x86_64 与 arm64，版本 `1.3.1`、identifier `app.quotafloat.desktop`、product `Codex Monitor`。可执行文件仅有 `adhoc,linker-signed` 签名，`TeamIdentifier` 未设置，Info.plist 未绑定，无 Developer ID、未公证；原 CI artifact App 的严格签名验证返回 `code object is not signed at all`，不称完整 App 包严格签名通过。未重新编译、打包、签名、公证或修理本机 hdiutil。

**应用兼容版本保持4；新增附加请求证据表；既有核心表、accounting和统计口径不变。** Fast 仅为本地 selected/requested 请求证据，不证明服务端最终执行档位或整轮所有请求档位；`feature.fast_mode=true` 不能单独证明 Fast。有可信新证据的历史记录可以恢复，缺证据或冲突的记录仍可能 Unknown，未宣称所有历史漏标全部恢复。未重新扫描用户历史或打开生产/诊断数据库。

Mecha、其他皮肤、中文字图、整体不透明度、窗口与 Branding 保持 Candidate 的已验收状态。手动更新、现有隐私限制、无云同步/遥测的边界不变。旧版本报告和当时的 Unknown、Pending、失败及未测结论保留，不能倒改成当时已通过。

本次 closure 仅纳入 `README.md`、本报告和任务书原文；从 Candidate 到归档 HEAD 的生产文件无差异，Tag 保持固定 Candidate。原工作区与 Fast 补丁工作区的 HEAD、分支、status、全部已跟踪/未跟踪文件指纹均核验保持，519 个历史预览/诊断文件保留；不删除补丁分支，不清理、reset、stash 或覆盖旧 Tag/Release/资产。

## Candidate 阶段历史记录（原文保留）

以下 Pending、未测与阶段停止点描述原 Candidate 交付时的状态；本轮最终人工验收与正式发布事实以上面的 Final Closure 为准。


工程验证完成。包含本补丁、测试、文档与五处版本化的最终完整 HEAD 定义为 **v1.3.1 Candidate Build Source**。最终源码 SHA、同一 SHA 的 CI 与安装包核验记录在独立交付目录的 `BUILD-INFO.txt`；只有这些全部通过后，交接状态才为 **Ready for v1.3.1 Human Acceptance**。Mac 与 Windows 人工验收仍 Pending。

基线：`58e14c488670f661406dc459fb3a2e8657f59db6`；沿用 `codex/fast-request-evidence` 分支及已有独立补丁。原 v1.3.0 Tag、发布安装包与历史验收报告不改写。本轮不合并 main、不创建 v1.3.1 Tag、不发布 Release、不自动安装，也不写生产 Monitor 数据库。已安装的 v1.3.0 不会因提交或推送源码自动修复。

## 缺陷与新增证据边界

部分已完成 Turn 没有在首次上下文前保存 `thread_settings_applied`，但指定本地诊断源保留了明确绑定到线程和 Turn 的 `service_tier=priority` 请求。原采集器仅有设置来源时，这些 Turn 留作 Unknown。

新增来源仅为当前有效 `CODEX_HOME/logs_2.sqlite` 中，经过结构核验的普通 `logs` 表及精确 `target=feedback_tags` 请求档位记录，不扩展到任意 Codex 数据库或全部诊断日志。

- 数据库线程 ID、`session_loop.thread_id`、`turn.thread.id` 必须一致；`turn.turn.id`、`run_sampling_request.turn_id`、`try_run_sampling_request.turn_id` 必须一致。
- 只解析结构化 tracing 前缀与末尾 `tags_json`。精确 `priority` / `fast` 表示 Fast 请求，精确 `default` 表示普通请求；未知值、缺值、损坏记录或身份不符均不建立归属。
- `feature.fast_mode=true` 只表明功能启用，不能单独证明请求为 Fast。不按模型、effort、Token、耗时或额度变化推断。
- 普通/Fast 请求冲突，或请求与已知初始设置冲突，保持 Unknown。
- 一条请求证据只表明该请求的本地 selected/requested 档位，不证明服务端执行档位，也不证明整轮所有请求使用相同档位。

真实来源核验沿用已有独立验证器记录：生产解析模块只读指定源，投影到隔离内存数据库；选定 Fast 与普通样本的归属均与独立诊断一致，没有相反结果。原报告的 Unknown 是当时可得证据下的结论；本报告记录新来源带来的恢复，不倒改历史验收。真实样本数量、身份、本机路径和本地诊断文件保留在仓库外。本轮没有重新扫描全部历史；自动测试均为合成 fixture。

## 兼容性

**应用兼容版本保持4；新增附加请求证据表；既有核心表、accounting和统计口径不变。**

`fast_request_evidence` 仅保存经过哈希的 root/thread/Turn 键与档位标志。已有核心表定义、accounting parser、Token 事实、统计口径及 JSONL accounting 游标不变。附加 DDL 在已有兼容性检查之后、现有打开事务内执行；同名异常表、视图、索引及大小写变体明确返回 `databaseIncompatible`，不会删除、替换或修复用户数据。

| 要求 | 证据与结果 |
| --- | --- |
| v1.3.0 旧库打开后增表 | `fast_request_schema4_upgrade_and_reopen_preserve_legacy_statistics`：由原四份 schema 构造无附加表的旧库，打开后建立正确列、主键和档位约束；版本仍 4，原 schema/accounting/元数据与统计逐值不变。 |
| foreign/future/parser 检查先于 DDL | `fast_request_incompatible_databases_are_unchanged_before_supplemental_ddl`：拒绝三类不兼容库，数据库字节、原对象与数据不变，无附加表或 sidecar 残留。 |
| DDL 与证据提交原子性 | `fast_request_late_migration_failure_rolls_back_supplemental_and_prior_ddl`：v1/v2 后续 DDL 失败时，附加表、前置 DDL 和版本一并回滚。既有 `fast_request_metadata_failed_commit_does_not_advance_source_cursor`：证据投影后事务失败，证据不半提交，读取位置不推进，后续刷新可重试。 |
| 同名异常对象 | `fast_request_same_name_table_view_or_index_is_rejected_without_data_loss`：五种异常对象（含大写名称与缺约束的伪同构表）明确拒绝；数据库字节和用户数据完整。 |
| 原 v1.3.0 访问代码继续读取 | 独立临时 Rust 探针直接编译 v1.3.0 Tag `98158b9df4c731ac486886f27a10b54b0672327c` 的原 store/reader/aggregate 等源码。旧代码创建合成库 → 当前补丁增表并采集 priority → 原旧代码 `open`、`open_reader` 与 aggregate 再读 → 补丁重开；16 项检查全部通过。 |
| 重开及原 repair/replay | 上述兼容测试重复重开，统计和附加证据逐值完整；`fast_request_metadata_survives_log_rotation_and_legacy_repair_restarts` 验证旧 revision-2 修复重放、源清理及重启后，请求证据仍保留并重新投影。 |

独立双向访问探针的合成预期：Token 总量 460（400 输入 + 60 输出）、倒序逐轮 Token `[340,120]`、额度 72.5 保持；Fast 从 `[false,null]` 变为 `[false,true]`。核心 schema、accounting、额度观测与 JSONL 指纹均未变化，完整性检查通过。该结果是源码/数据库兼容证据，不是安装或原生人工验收；未对生产库执行降级或来回安装实验。

## 只读、安全与刷新

- 来源连接为 `READ_ONLY | NOFOLLOW`，不存在不创建；拒绝 symlink，正常读取活动 WAL，不用 immutable。不执行源 DDL、写事务、checkpoint、VACUUM、journal 模式修改，不改权限、不停止 Codex、不启用全局诊断。
- 开始分页前核对普通 rowid 表、单列 INTEGER 主键别名与所需文本列，拒绝视图、无主键、复合主键、`WITHOUT ROWID` 及非 rowid 别名主键。
- 每次最多扫描 1,024 条源行（包括无关 target），每条请求正文最多 64 KiB，线程 ID 只返回 36 字节文本；目标比较使用 BINARY 精确匹配。锁等待最多 25 ms，读取逐行检查取消。
- 近期优先，后续每次为新增行和历史回放分配预算。超长、损坏、错误类型及无关记录仍推进分页；`history_progresses_under_continuous_unrelated_live_logs` 验证每轮持续新增 600 条时历史端仍推进并恢复旧记录。
- root 与源文件共同绑定游标；`root_switch_does_not_reuse_even_a_hardlinked_cursor` 验证相同物理诊断文件也不跨 root 复用游标，缺少诊断源的第三 root 不继承证据。持久证据按 root 隔离。
- 源缺失、锁定、损坏、格式不兼容不阻断原有 Token 统计，也不清除已核实证据。错误只保留通用状态，不记录原始日志、`tags_json`、真实 ID、凭据或私人路径。

原补丁的精确值域、身份绑定、功能开关隔离、冲突、WAL、轮换、分页、失败回滚和 symlink 用例继续保留。本轮新增结构、长度、精确 target、持续写入、root 隔离、取消与兼容性测试，没有重新设计解析或改动闪电 UI。

### 已完成 Turn 的证据刷新链路

`fast_request_metadata_service_refresh_emits_committed_quota_snapshot` 使用实际 `TokenStatisticsService`：已完成 Turn 初始 Unknown，JSONL、Token、accounting 游标及 quota snapshots 均不再变化；诊断库随后写入合法 priority 请求；正常 refresh 将证据投影与 generation 增长放入同一事务，提交后发出通知，Quota Week 快照变为 Fast。普通对照行、Token、排序及额度全部保持。

测试把实际 Rust 合成快照和提交通知交给 `tests/fastRequestRefresh.test.tsx`，经过现有 controller / hook / Quota Week DOM 后自动显示既有闪电，普通行 DOM 及全部其他列不变；只注册一次监听，无重启、删缓存或重建数据库。该跨层用例已在本地联跑；常规 Frontend CI 继续独立执行合成通知用例。它不替代真实安装后的原生验收。

## 最终工程回归

2026-10-03，沿用现有命令与临时 Rust 1.99.0 工具链：

| 检查 | 结果 |
| --- | --- |
| `npm test` | **273 tests / 19 files Passed**；本地联跑包含 Rust 输出的刷新快照。 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | **154 Passed / 2 既有 ignored**；完整命令包含 main 测试目标与 doc-tests（各 0 测试）。Fast 命名测试 **46 Passed**，不以 `--lib` 代替完整范围。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | Passed。 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | Passed。 |
| `npm run build` | TypeScript / Vite Passed。 |
| `npm run check:updater-policy` | Passed，仍为手动下载更新。 |
| `npm audit --audit-level=high` / `npm audit --omit=dev --audit-level=high` | 均为 **0 vulnerabilities**。 |
| `git diff --check` | Passed。 |

新增兼容 fixture 初轮因手写 UTC 格式与原代码规范化格式不同而失败，修正 fixture 后完整回归通过；业务时间、额度关联口径未改。Node 文件读取仅在独立测试目录使用，没有为测试增加应用依赖。

五个版本事实源统一为 **1.3.1**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。依赖不升级，identifier 仍为 **app.quotafloat.desktop**。

未改 Mecha 与三套旧皮肤、文字补片、透明度、窗口交互、Branding、accounting、额度周倒序、额度观测或现有 workflow。原开发工作区及 519 个历史文件不作为本轮写入目标；原有保护核验记录保留。`PRIVACY.md` 和 README 仅同步本次读取范围与证据限制；旧发布报告保留当时结论。

## CI 制品与人工验收

复用现有 GitHub Actions，核对同一个完整 Candidate SHA 的 Frontend、Windows、macOS 与 Windows GUI subsystem。只从该次 CI 提取 Universal DMG 和 NSIS 安装包，核验 GitHub artifact ZIP 的大小、摘要、CRC，以及原安装包与最终改名副本的 SHA-256。无本机 DMG 重建、launcher、debug 或裸 EXE 交付。完整 SHA、CI URL、包大小和摘要随 `BUILD-INFO.txt`、`SHA256SUMS.txt` 交付。

Mac 待验证：可采集的已核实漏标记录恢复闪电；普通记录无误标；新 Fast/普通任务；退出和重启后标识保持；Token 总量、额度、倒序与皮肤不变。

Windows 同事仅安装、启动、正常使用、退出、重启；有真实 Fast 数据时验证 Fast，无真实数据则记录该项未测，不要求命令、SQL、Git 或日志诊断。

历史回放在正常刷新中分批推进，未扫描到不等于永久无法恢复；日志已清理且没有其他可信证据的历史 Turn 仍可能 Unknown。本轮未全量扫描或核验全部历史，不宣称所有漏标均已恢复。工程/CI/制品通过只代表进入人工验收，最终停止点为 **Ready for v1.3.1 Human Acceptance**。

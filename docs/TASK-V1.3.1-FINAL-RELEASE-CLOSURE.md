# Codex Monitor v1.3.1 — Final Release & Closure

Task ID: `CM-131-FINAL-RELEASE-CLOSURE`

**当前状态：用户对本轮 Candidate 已明确回复「人工验收通过」。此文件下达发布收口流程，不代表 Tag/Release 已创建。用户将本任务交给 Mac 上的 Codex 并指示执行后，按下文完成发布与归档。**

## 1. 固定发布事实源

| 项目 | 固定值 |
| --- | --- |
| Repository | `bennick1/codex-monitor` |
| 补丁分支 | `codex/fast-request-evidence` |
| Accepted Candidate / Release Source | `0bce678f28d2123361a97d4fcdfaf1b69420fb2f` |
| Accepted Candidate CI | `37084876209` |
| 核验时 main | `58e14c488670f661406dc459fb3a2e8657f59db6` |
| Version / 应用数据库兼容版本 | `1.3.1` / `4` |
| Product / Identifier | `Codex Monitor` / `app.quotafloat.desktop` |

用户确认针对上一轮交付的该 Candidate，而非其他本机构建或旧 v1.3.0。最终人工验收记录为 **Passed — 用户明确确认**；具体平台、场景沿用实际验收记录，不把未执行的 Windows Fast 场景、全量历史覆盖或无障碍检查自动升级为 Passed。

**本任务自身是 Candidate 后新增的 docs-only 提交。补丁分支 HEAD 因本任务前进是正常状态，不是新 Candidate。Tag 与正式安装包始终绑定 `0bce678…`，不能指向本任务或发布后 closure 提交。**

## 2. 本轮仅发布，不再修代码

复用 v1.3.0 已经成功的发布方式：核对已验收制品 → main 快进到固定 Candidate → annotated tag → 发布同一批安装包 → 远端回下载核验 → 文档归档。

禁止修改生产源码、请求证据解析与投影、附加表、版本、依赖、CI、Fast UI、皮肤、中文补片、不透明度、窗口、accounting、额度观测和排序；禁止新建另一份 final build、重新打包/签名/公证、修本机 hdiutil、运行历史 v1.1.0 专用 release.yml 或整体合并上游。

不让 Windows 同事执行任何工程任务，不要求对同一批制品重复人工验收。不重新打开生产数据库、诊断库或用户会话调查历史样本。

## 3. Git 安全与可续跑规则

1. 读取当前 AGENTS.md 和相关发布规范，检查当前 HEAD、status、branch、worktree、remote。复用已有授权访问 GitHub。
2. 保护原工作区、独立 Fast 补丁工作区及 519 个历史预览/诊断文件。不得 git clean、自动 stash、reset --hard、强制 checkout、force push 或 git add .。区分已跟踪改动与保留的未跟踪文件，不为了“全干净”删除历史。
3. 复用干净的 main 发布 worktree；没有则新建独立发布 worktree。不在用户原工作区强行切 main。
4. fetch origin；有网络问题时采用已有命令级 HTTP/1.1 和有界重试，不改全局代理或 Git 设置。该任务已授权安全 ff-only 同步，不重复请求相同授权。
5. 确认固定 Candidate 对象存在，原 main 是其祖先。补丁分支在 Candidate 之后只有本任务等已知 docs-only 内容时允许继续；不把分支最新 HEAD 自动作为发布目标。
6. main 仍为表中旧值时快进到固定 Candidate；已经是 Candidate 则续作；若已存在相同版本的有效 closure，先核验是否为重复执行。遇到未知 main 变更、分叉或新生产改动则停止说明，不覆盖。
7. Tag/Release 如已存在，先核对目标和资产。完全匹配则幂等完成剩余归档；内容不同则停止，不删除重建、不移动 Tag、不覆盖安装包。

## 4. 先核验实际安装包，再动 main 和 Tag

### 4.1 人工验收安装包

既有交付目录：`$HOME/Downloads/Codex-Monitor-v1.3.1-Test-0bce678/`。

读取其中 `BUILD-INFO.txt` 和 `SHA256SUMS.txt`，确认 Source SHA/Run 与第1节一致。重新计算文件大小和 SHA-256，不仅相信文件名。

| 平台 / 正式资产名 | Bytes | 已验收 SHA-256 |
| --- | ---: | --- |
| macOS Universal：`Codex-Monitor-1.3.1.dmg` | 15075069 | `5610ce3ba2719982b1ae0adf49c75c87802cdd7ab1259c23bb53ed3c4a45c012` |
| Windows x64 NSIS：`Codex-Monitor-1.3.1.exe` | 4951618 | `e59db1cdaee1f6ab83349aed6bea541cc90cfa1cd2684da624f37215ab3f56e9` |

正式名只是验收包的复制/重命名，内容必须完全相同。当前核验依据包括用户已交付的文件摘要和 CI 元数据；发布执行者仍须亲自重算本地/下载字节，不把任务书里的预期值当成本轮实际验证结果。

### 4.2 唯一 CI 来源

重新核对 Run `37084876209`：head_sha 为固定 Candidate，status=completed、conclusion=success。Frontend、macOS、Windows、Windows GUI subsystem 已有成功结果，读取真实状态确认。

该 Run 的 Actions artifacts（核验时未过期）：

| Artifact | ID | ZIP bytes | ZIP SHA-256 |
| --- | ---: | ---: | --- |
| `codex-monitor-macos-universal-unsigned` | 11260447639 | 30324243 | `1f9423bb708aa39ad545338fe018851479c941eb5eee3950c368b4e58de9ece2` |
| `codex-monitor-windows-unsigned` | 11259763580 | 11401656 | `910100fccc13a47f25bbcf55d771bc57897eb573198c2de8540cf27826800d03` |

ZIP 的摘要与其中安装包摘要是不同对象，不要混用。可复用已验证的本地原始 archive；否则从该 Run 下载，用现有工具核对 ZIP 摘要、大小、CRC 和包内 installer。

原始 CI installer、用户验收副本和正式命名文件应 byte-identical。任意不一致先停止调查，不下载其他 Run 的“同版本”替换。若 artifact 过期但保留了具有完整来源记录且摘要一致的验收原件，可以核验后复用；无法证实来源时停止，不能重新编译并继承旧验收。

### 4.3 发布暂存与校验文件

使用仓库外或既有忽略目录暂存；不覆盖旧 staging，不提交二进制至 Git。

正式 Release 只含：

- `Codex-Monitor-1.3.1.dmg`
- `Codex-Monitor-1.3.1.exe`
- `SHA256SUMS`

以 LF、UTF-8 无 BOM 生成以下两行，文件末尾换行：

```text
5610ce3ba2719982b1ae0adf49c75c87802cdd7ab1259c23bb53ed3c4a45c012  Codex-Monitor-1.3.1.dmg
e59db1cdaee1f6ab83349aed6bea541cc90cfa1cd2684da624f37215ab3f56e9  Codex-Monitor-1.3.1.exe
```

执行校验并记录三个文件的实际大小和 SHA-256，包括 SHA256SUMS 本身。不要在重新签名或修改安装包之后仍复用旧摘要。

## 5. main 快进与既有 CI

在干净 main 发布 worktree，确认五个应用版本事实源为 1.3.1、identifier/product 未变、应用兼容版本为4。

仅允许 main 以 ff-only 方式到 **`0bce678f28d2123361a97d4fcdfaf1b69420fb2f`**，不是到补丁分支最新文档 HEAD。不得产生 merge commit、squash 或 rebase。普通 push 后通过 ls-remote 或 GitHub API 独立核验。

main push 自然触发的现有 CI，记录 run_id、head_sha、head_branch 与全部结果。按已用发布门槛等待成功；若确有配置跳过而没有生成 Run，说明原因并沿用 exact Candidate 的成功证据，不创造空提交或新 workflow 来凑门槛。

若仅出现既有测试 `concurrent_refresh_is_coalesced_and_queries_use_committed_generation` 的 startup readiness deadline 超时，先保留日志，可用 GitHub 原生 Re-run failed job 一次。再失败或其他失败先报告，不修改 timeout、测试或生产代码。重跑成功不证明时序隐患已经修复。

main/Tag/docs push 如自动产生新安装包，一律不作为正式 Release 的替代源。不重新 dispatch Candidate。

## 6. Annotated Tag 与正式 Release

1. 确认 `v1.3.1` 未存在，或已存在且与本任务完全匹配。
2. 缺失时创建 annotated tag，message 为 `Codex Monitor v1.3.1`，精确指向固定 Candidate。普通推送；核对 tag object 类型及 peeled target。不创建 lightweight tag，不移动已有 Tag。
3. 使用已有 GitHub CLI/授权接口创建 `Codex Monitor v1.3.1`，Tag 为 `v1.3.1`。可先创建 draft、上传并检查后再公开；最终 draft=false、prerelease=false。
4. 上传第4节的两个实际已验收安装包及 SHA256SUMS。不要上传 ZIP、PDB、raw/debug EXE、测试包名称、BUILD-INFO、诊断日志或用户截图。
5. 读取远端资产的名称、大小和 digest（若提供），并重新下载三份 Release 资产，计算摘要并与暂存原件逐字节核对。不能只验证 upload 命令返回成功。
6. 核验 Release URL、ID、发布时间以及 Tag target。自然触发的 Tag CI 记录实际结果，不更换制品。

## 7. Release Notes 与必须保留的边界

说明本版是 Fast 漏标修复，不是 UI 新设计。建议简明写出：

- 修复部分已完成 Turn 因缺少初始设置记录而不显示 Fast 闪电的问题。
- 新增当前 CODEX_HOME 中限定本地诊断源的只读请求证据，严格匹配线程与 Turn；仅在有可信记录时补充识别。
- 支持已有完成记录的分批回放和正常刷新，已采集证据在日志清理或重启后保留。
- 缺少可信证据或相互冲突的记录继续为 Unknown；不声称所有历史漏标均可恢复。
- 源缺失、锁定或格式不兼容不阻断原有 Token 统计。
- 应用兼容版本仍为4，新增附加请求证据表；既有核心表、Token accounting、额度观测与倒序口径不变。
- Mecha、其他皮肤、中文字图、不透明度、窗口行为和 CM Branding 沿用 v1.3.0。

Fast 仍表示本地 selected/requested evidence，不证明服务端最终执行档位，也不证明整轮所有请求都使用同一档位。`feature.fast_mode=true` 不能单独证明 Fast。不能凭用户回忆、模型、effort、Token 或额度变化回填。

历史 Unknown 报告保持当时的证据结论；本版新来源可支持新的恢复结果，但不把旧报告倒改为当时已验证。普通人工验收通过不等于全量历史、Windows 缺样本的 Fast 用例或读屏器/WCAG 全通过。

不新增网络、云同步、遥测或自动更新能力。隐私说明已在 Candidate 更新，发布任务不扩大读取范围，也不额外做一次用户历史全量扫描。

签名状态以已验收 artifact 的 BUILD-INFO 与现有证据为准：Windows 未签名；macOS 没有 Developer ID／未公证，linker ad-hoc 若存在不得表述为 Developer ID 或完整 App 包严格签名通过。不得临时重签名或修改 signing pipeline。

## 8. 发布后 docs-only Closure

只有正式发布与远端资产验证成功后，才更新：

1. `README.md`：Current release、安装包名称和报告链接改为 v1.3.1，指向现有 `docs/fast-request-metadata-validation.md`；保持四套皮肤、整体不透明度、手动更新和现有隐私限制，不全文重写。
2. `docs/fast-request-metadata-validation.md`：顶部新增 Final Closure，记录用户原话「人工验收通过」、accepted source、CI、Tag object/target、Release ID/URL/时间、三个资产的大小与摘要、实际签名及验收范围。保留历史 Pending/未测的证据过程，并明确最新最终结论，不删失败记录。
3. 将本任务文件原文纳入 main 的 docs-only closure，保留任务出处；无需为此把补丁分支的文档 HEAD 先当成 Release Source。

不新建重复巨型报告，不修改旧版本报告、PRIVACY.md 已验收内容或生产源码。逐项 git add 后检查暂存文件只属于上列文档。

提交：`docs: record v1.3.1 release closure`，普通 push main。检查 main 从 Candidate 到最终 HEAD 除授权文档外零生产差异。**`v1.3.1` Tag 永远保持指向 Candidate，不随 closure 移动。**

归档自然触发 CI 则记录/等待结果；如发生已知单次 readiness 超时，可按第5节只重跑一次。归档 CI 失败时如实标记 closure 待处理，不能谎称全绿，也不能回滚已核验发布或换包。

## 9. 完成定义与交接

仅当固定 Candidate 成功验证、main 快进、annotated Tag 正确、Release 正式公开、三资产回下载一致、文档已推送且远端核验完成，最终报告：**Released & Closed — v1.3.1**。

报告只需：

- Accepted Source、用户人工验收依据、Candidate/Main/Tag/Closure CI 的真实结果；
- Tag object 与 peeled target；
- main before/after、closure SHA、远端一致性；
- Release 链接、ID、发布时间、draft/prerelease；
- 三个资产的实际 Bytes/SHA-256 和与验收包的一致性；
- 应用兼容版本4及附加表的准确表述、Fast 证据限制与实际签名；
- 发布 worktree 状态、旧分支/旧Release/原工作区及历史文件未改变。

不删除补丁分支，不做发布后磁盘/历史预览大扫除，不隐藏未跟踪文件状态。

任何真实失败，报告精确步骤及已完成的远端操作。可续跑的网络/权限问题保留现场，不自动回滚、重建Tag或替换制品；需要修改生产代码则另开修复周期，本任务不得静默换 Candidate。

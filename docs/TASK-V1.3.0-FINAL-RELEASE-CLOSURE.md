# Codex Monitor v1.3.0 — Final Release & Closure

Task ID: `CM-130-FINAL-RELEASE-CLOSURE`

**人工验收已通过；本文件下达发布收口流程，不代表 Tag/Release 已创建。** 用户将本任务交给 Mac 上的 Codex 并指示执行后，按下文完成发布及归档。不要重开设计或开发，不让 Windows 同事承担工程操作。

## 1. 固定发布事实源

| 字段 | 固定值 |
| --- | --- |
| Repository | `bennick1/codex-monitor` |
| 开发分支 | `feat/v1.3.0-fast-opacity-mecha-skin` |
| Accepted Candidate / Release Source | `98158b9df4c731ac486886f27a10b54b0672327c` |
| Accepted Candidate CI | `37021024626`，head_sha 必须等于上述 SHA |
| 核验时 main | `9b7e37c445fc3cc37d512c54cc310a1b8cc67c9b` |
| Version / Schema | `1.3.0` / `4` |
| Product / Identifier | `Codex Monitor` / `app.quotafloat.desktop` |

用户在该 Candidate 双端制品交接后明确回复：**“人工验收完成，无问题”**。以此记录本轮最终 Native Human Acceptance 通过，来源是用户明确确认，不是自动测试代签。此前 Mecha Tabs 三色直接参考和交互派生也已有单独人工签署。

**本任务文档是 Candidate 后新增的 docs-only 提交。它不是新 Candidate，不需要重新构建或重新验收。开发分支 HEAD 因本任务前进是预期情况。Tag 和正式安装包必须继续绑定 `98158b9…`，绝对不能改绑任务提交或后续 closure 文档提交。**

## 2. 只做发布，不再改变成果

允许：只读核验、main 快进到固定 Candidate、annotated tag、上传已验收安装包、发布 GitHub Release、发布后文档归档。

禁止：修改生产源码、图片/字体/补片/生成参数、Fast 规则、不透明度、Schema、accounting、排序、窗口尺寸、Branding、依赖、版本、CI；重新打包/签名/公证；创建新的所谓 final build；采用其他 CI Run 产物替换验收包；force push、移动已发布 tag、squash/rebase 或顺手清理历史文件。

不重新执行本机 Tauri/DMG 构建，不修 hdiutil，不 dispatch 旧 `release.yml`。已核验该文件只是 workflow_dispatch 的历史 v1.1.0 Release Preparation，有旧版本断言；本轮不运行、不整改它。继续复用 v1.2.0/v1.2.1 的“发布已验收 CI 产物”流程。

## 3. Git 安全前置与可续跑规则

1. 读取当前 AGENTS.md 及必要项目说明，检查 status、HEAD、branch、worktree、remote。使用现有授权访问 GitHub。
2. 原工作区有 519 个历史预览/诊断未跟踪文件是用户已知状态，不等于要删除或重新提交。不得 `git clean`、自动 stash、reset --hard 或 `git add .`。区分“已跟踪内容干净”和“仍有保留的未跟踪文件”，如实报告。
3. 复用干净 main worktree；没有则建立独立发布 worktree。不要在用户原工作区强行切换分支。
4. fetch origin，必要时使用已验证的单命令级 HTTP/1.1。网络无响应时用有界重试，不改全局 Git/代理配置，不让用户重复确认本任务已授权的安全快进。
5. 核对 Candidate 对象存在，origin/main 是该 Candidate 的祖先。只读确认五个版本事实源均为 1.3.0、Schema 4、identifier/product 正确。
6. 开发分支在 Candidate 之后仅新增本任务及明确的 docs-only 记录是允许状态，不据此错误停工。若出现新 production 改动，停止评审；不能自动把更新代码当已验收代码。
7. main 若仍为上述旧值，按第5节安全快进；若已是 Candidate，直接续做；若已含此前成功发布的 docs-only closure，先检查是否重复执行。main 出现未知或分叉提交时停止，不覆盖。
8. Tag/Release 若已经存在，先读回核验目标、资产与发布状态。完全相同则幂等续做缺失归档；不删除重建、不重新上传替换。目标或内容不同则停止说明冲突。

## 4. 验收制品与来源核验：先完成，再动 main/Tag

### 4.1 已验收安装包

以下安装包大小/摘要来自用户最后一轮交付记录，执行者须用现有本地文件和 Candidate CI 产物重新核验。不要把本任务抄录的摘要当成已经重新下载比对。

| 正式发布名称（仅改名） | Bytes | SHA-256 |
| --- | ---: | --- |
| `Codex-Monitor-1.3.0.dmg` | 15056030 | `d6b1dc66b89c15fef8b3e2f18fcd079e9f8c14f0840faca7c4dc59c4d6723cda` |
| `Codex-Monitor-1.3.0.exe` | 4932733 | `4f02e00c29d368afa741ea99c1df661ad203d4275b3cc21a666b09f9c6acc9fa` |

已验收目录：`$HOME/Downloads/Codex-Monitor-v1.3.0-Final-Test-98158b9/`。

其中原测试名称为 `Codex-Monitor-1.3.0-macOS-Test.dmg` 和 `Codex-Monitor-1.3.0-Windows-Test.exe`，来源说明在同目录 BUILD-INFO.txt。

### 4.2 已实时核验的 Candidate CI artifact 元数据

Run `37021024626`：completed/success、attempt 1；Frontend、Windows、macOS 和 Windows GUI subsystem 成功。

| Artifact | ID | ZIP Bytes | ZIP SHA-256 |
| --- | ---: | ---: | --- |
| `codex-monitor-macos-universal-unsigned` | 11233766287 | 30292064 | `4c976449d745d6b2fce0a9b613e4552d52d45f7526c10ed99c7da3f91f4617d0` |
| `codex-monitor-windows-unsigned` | 11233981053 | 11351897 | `27f9af39ef1229a4493cf2117a8dbc5ae37cfc04dff57bbe7f542e8b006ee801` |

两项 workflow_run.head_sha 均为 `98158b9df4c731ac486886f27a10b54b0672327c`。编制时未过期，expiry 为 2026-10-16 UTC；执行时重新检查。ZIP 摘要与内部 DMG/EXE 摘要是不同对象，不可混用。

优先复用已经保存且核验一致的原始 CI staging。需要时从该 exact Run 下载，检查 ZIP 摘要/CRC，再定位其中 DMG 与 NSIS setup.exe。不要猜解压后的固定前缀路径，不用裸 EXE、debug、PDB 或其他版本。

若 artifact 过期但有带原来源记录、大小和冻结 SHA 全部匹配的已验收本地安装包，可复用该原件并记录恢复来源；不能因此换 Run 或重新构建。无法证明来源或摘要不符则停止。

复制到独立 release staging，仅改为上表正式名称。与 CI 原件和实际验收包逐字节比较，复核大小和 SHA。

复用现有 `scripts/prepare-release-artifacts.mjs` 时先只读检查是否适用当前版本和输入；若包含构建、覆写不同文件或改变字节等行为，不运行该部分。允许直接安全复制和使用系统 SHA 工具，不为了命名再造流水线。

生成 UTF-8、LF 的 `SHA256SUMS`，只包含两行正式安装包及其摘要，之后重新核验清单。原 BUILD-INFO 和测试目录不覆盖。安装包、日志、数据库、真实账号截图一律不提交 Git。

## 5. main 快进与现有 CI

在干净发布 worktree，安全同步旧 origin/main 后执行等价于：

```sh
git merge --ff-only 98158b9df4c731ac486886f27a10b54b0672327c
git push origin main
git ls-remote origin refs/heads/main
```

目标是 **固定 Candidate SHA，不是 feature 分支 HEAD**。不产生 merge commit。仅本地落后但可安全 fast-forward 时允许直接同步，不因“本地尚未到远端”再次请求批准。

main push 自然触发的现有 `.github/workflows/ci.yml`，核对 branch=main、head_sha=Candidate。等待当前真实结果，全部成功后进入 Tag/Release。

不主动重新跑 Candidate、不 push 空提交、不改 workflow。若同 SHA 的 main CI 已成功则复用。

仅当失败明确是既有 Windows `concurrent_refresh_is_coalesced_and_queries_use_committed_generation` 的 startup readiness 超时时，允许 GitHub 原生失败 job 重跑一次。保存首次失败，不能仅凭重跑成功断言产品绝无相关问题。不改 timeout、不 ignore 测试；重复或不同失败需停止评审。

main/tag/文档 push 若自然产生新 artifact，都不替换第4节已验收制品。任何文档CI不改变发布来源。

## 6. annotated Tag 与正式 Release

1. 再核对 main 与验收 Source、准备好的两份安装包及 SHA256SUMS。
2. 创建 annotated `v1.3.0`，明确 target 为 `98158b9df4c731ac486886f27a10b54b0672327c`，message 为 `Codex Monitor v1.3.0`，普通 push tag。
3. 用远端 tag object/peeled target 核验，不能只看 tag 名或 Release 的 target_commitish 文本。
4. 使用 Mac 上现有 `gh` 或等价授权入口。可先建立 draft，上传下列3项并核验后再发布；draft 只是原子交付的暂存步骤，最终必须 draft=false、prerelease=false。
5. 正式 Title：`Codex Monitor v1.3.0`，Tag：`v1.3.0`。仅上传 `Codex-Monitor-1.3.0.dmg`、`Codex-Monitor-1.3.0.exe`、`SHA256SUMS`。GitHub 自动生成的 Source code archives 不属于手工上传的3项。
6. 上传后核对 asset 名称、状态、size、digest（有则核对）；重新下载远端安装包和清单，验证 SHA 与逐字节一致性。完成后发布，再读回 published_at、ID、draft/prerelease 和最终资产列表。
7. 不使用 upload --clobber 等覆盖已有不同制品的快捷方式；中断后先核验既有结果再续做，不移动 tag。

只有自动流水线明确会产生冲突发布写操作才暂停评审；当前已查 release.yml 仅手动运行且 contents:read，不自动发布。不要因为文件名叫 release.yml 就运行它。

## 7. Release Notes 内容边界

面向用户说明本版实际变化：

- 修复 Fast 闪电在已知 compaction、重复 context、增量/历史元数据恢复场景中的漏标，并兼容明确 `priority` / `fast` 值。
- 新增整体不透明度，60%–100%、步进5%、默认100%，窗口背景、文字、图标和装饰共同变化；四皮肤、展开/收起及偏好恢复适配。
- 新增免费 Mecha Light 浅色机甲皮肤，银白装甲与蓝/黄橙/红状态色；展开/收起使用一致状态语言。
- 保留额度周倒序、Token accounting、Schema 4、既有 App/Tray Branding 和手动更新方式。

限制必须准确披露：

- Fast 是本地持久化 selected/requested evidence，不是服务端最终执行档位确认。没有当时可信证据的历史行仍 Unknown，用户最初指出的两条历史记录不能写成已修复或回填。
- Mecha 的三个固定中文 Tab 使用批准稿派生字图；真实按钮/可访问名称/失败回退保留，英文仍为文字。不能声称支持所有字体替换、仅文字放大或已通过读屏器/完整 WCAG 验收。精简说明或链接既有完整限制，不隐瞒。
- 三色原图零差异限定于文档记录的258×36、DPR1、100%环境；用户原生观感通过不把这个数字推广到所有平台、缩放和交互状态。
- Manual Reset 的不可观察成功信号仍是已知限制，本版不声称实现手动重置边界。
- Windows 未签名；macOS DMG/App 包未签名、未公证，可执行文件只有 linker ad-hoc 签名。严格包签名返回未签名，不写为 Passed、Developer ID 签名或 Apple verified。不临时重签已验收包。

不要求重新截图或重画皮肤。需要图时只复用已有合成截图，禁止上传真实数据。文案以用户已验收功能和现有报告为依据，不添加未实现能力。

## 8. 发布后 docs-only closure

只有正式 Release 与远端资产核验完成后，更新：

- `README.md`：Current release / 安装包名称/验证报告指向 v1.3.0；三套免费皮肤改四套，新增 Mecha Light 与整体不透明度说明；Fast 别名与缺证据限制；Schema 4 保持而不是宣称升级到5；签名实际状态。保留历史文字及手动更新定位，不全文重写、不批量替换旧报告版本号。
- `docs/v1.3.0-feature-validation-report.md`：顶部最终 closure，记录用户这次对 exact Candidate 的 Native Human Acceptance；Source SHA、Candidate/main CI、Tag object/target、Release ID/URL/time、正式制品size/hash、签名限制。区分已经发生的浏览器图像签署与本次最终原生验收，保留旧失败、Unknown 与未独立验收限制。
- 必要时 `docs/design/v1.3.0/mecha-light/tabs-reference-exact/text-layer-final-20261002/report.md`：仅追加最终发布 provenance 与此次原生结果；不重写原始对照环境，不改资源/哈希/截图。
- 本任务文档可原样收入同次 closure 便于 main 留档；这只允许复制任务文件，不允许把 feature HEAD 直接并入 main 来替代固定 Candidate。

在 main 创建 `docs: record v1.3.0 release closure`，普通推送并读回确认。除上述文档外不得出现生产文件差异；Tag 永远留在 Candidate。

文档提交自动触发 CI 则检查结果；它不改发布源码，不用其产物换包，也不为记录CI再无限新增文档提交。若最终仍在运行，准确报告 Published — Closure CI Pending，不能提前写全闭环；失败则报告具体归档/CI问题，不自动删除Release或移动Tag。

## 9. 保留本地历史，不做清理支线

原有519个历史预览/诊断文件及保险包继续保留原位，不提交全部、不删除、不把它们当作发布失败原因。保护其他worktree内容。

最终说明：发布worktree已跟踪改动是否干净、远端是否一致、原工作区仍保留哪些未跟踪类别。不要声称全仓库无未跟踪文件。

开发分支保留，不删除也不强制同步到 main closure。版本保持1.3.0，旧v1.2.0/v1.2.1 Tag和Release不动。

## 10. 完成状态与中断处理

只有人工通过、来源与摘要核验、main快进/CI、annotated Tag精确绑定、Release已发布且远端制品核验、docs closure推送/最终状态核对全部完成，才报告：

**Released & Closed — v1.3.0**。

仍有已发布但未完成归档、CI或网络操作时，写 Published — 对应Pending，保留远端实际状态；不得误报未发布或自动回滚。发布前阻塞则写 Blocked — 具体原因。

若需任何新的生产修改，停止本发布任务，不擅自创建另一个候选。不得对正在等待结果的工作谎称后台继续执行。

## 11. 最终回复格式

简要列出：

1. 用户人工确认已归档；Released Source完整SHA、Candidate Run、main同SHA CI。
2. main Before / Final closure SHA、远端一致性。
3. annotated Tag object SHA、peeled Candidate SHA。
4. 三个正式assets名称、字节数、SHA-256及远端重新下载一致性。
5. Release ID、URL、发布时间、draft/prerelease。
6. README/报告closure、CI状态、签名与重要证据限制。
7. 原历史文件/开发分支保留，已跟踪工作区状态。
8. 真实Final State。

**本任务到正式发布收口为止，不再视觉微调、不重新制造安装包、不再给同事布置开发任务。**

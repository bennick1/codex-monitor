# Codex Monitor 1.4.0 发布准备

任务：`CM-RELEASE-PREP-20261103`。日期：2026-11-03，Asia/Shanghai。

> 以下保留各阶段的历史记录与当时边界；生产配置实施记录见 `CM-RELEASE-ENABLEMENT-20261103`，最新状态以文末“维护者确认 Windows 验证完成”为准。上一轮只读配置边界已由维护者后续授权替代，原有验收证据和未明确解除的发布要求继续有效。

**结论：候选版本、Mac arm64 菜单栏定向升级验证和双平台 CI 制品已准备好，可集中审阅；正式发布仍受生产配置、审核保护及 Windows 原生升级验收阻塞。** 本轮未合并准备 PR、未打 tag、未创建 Release、未触发 Signed Release、未修改保护或生产密钥。

## 基线、版本与改动

| 项目 | 本轮事实 |
| --- | --- |
| 仓库 / 合并基线 | `bennick1/codex-monitor`；独立 fetch 后 `origin/main=691f7dd1a9abe6bdb12bd0b2e81bb703775b40c1`，即 [PR #1](https://github.com/bennick1/codex-monitor/pull/1) 合并提交 |
| 已验收功能 / 产品基线 | 功能 HEAD `b20b29b32d1ec3d8126679a67064206a1cbdd7b7`；此前真实账户产品构建 `9f34e3b6b45a3a9b0f7b0a18faa851fb73cc7c14`；均已包含在本轮 main 基线 |
| 发布准备分支 | `agent/release-prep-1.4.0`，从核实后的 main 新建独立 worktree；没有重合并旧功能分支 |
| 候选源码与 CI 构建 SHA | **`2a3e34c81d7087a020b02130ccf2b2f26e1a4832`** |
| 后续记录提交 | 本文为候选之后的仅文档记录，未改变产品、版本、依赖、工作流或构建输入；其精确 HEAD、CI 终态及独立同步结果另在准备 PR 和最终交付中核实，不把候选 CI 冒称为记录 HEAD 的 CI |
| 远端版本核查 | 11:17:55 +08 查询全部 6 个 Release、17 个 tag；最新 published 为 `v1.3.1`（Release ID `403027234`），`v1.4.0` tag/Release 均不存在，无更高版本；采用 `1.4.0`，发布前仍须重查 |
| 六处版本 | package.json、package-lock.json 根及根 package、Cargo.toml、Cargo.lock 中本应用、tauri.conf.json 均 `1.4.0` |

仅修改本应用版本、现行版本说明和 Release Notes 输入；增加 `npm run check`，执行 TypeScript 与既有 updater 静态策略检查。npm/Rust 的依赖声明与锁定项逐项保持不变。菜单栏、R1 布局、皮肤、统计、认证、更新客户端逻辑均未修改；没有发现需要产品修复的升级问题。历史验收记录中的旧版本未改。

[实际发布说明](releases/1.4.0.md)覆盖此前未公开的侧边栏、在线更新和 macOS 仅菜单栏模式：仅周额度按实际周期展示、展开复用完整卡片、面板关闭后持续刷新、旧展示模式保留。Windows 不宣称拥有 macOS 菜单栏体验。公开 v1.3.1 用户须手动安装首个带 updater 的正式版本；新客户端后台仅检查，下载和安装分别由用户主动操作。

工作流从冻结 source SHA 读取 `docs/releases/<version>.md`，同时用于 GitHub Release 正文和 `latest.json.notes`。缺失/空说明在输出 manifest 前失败；说明参与最终 `SHA256SUMS`。原 main/manual、environment、双平台验签、归档内部身份与来源绑定、draft 上传/回读核对后 publish 等门槛全部保留。

## 本次实测：Mac arm64 A → B

环境：macOS 27.0.1（26A434）arm64、Node 22.23.1、npm 10.9.8、Rust 1.99.1、Tauri CLI 2.11.4。使用独立 `app.codexmonitor.updater-test.local` / `Codex Monitor Updater QA`，全程空 `CODEX_HOME`、合成额度及统计、`127.0.0.1:18765`；真实账户及正式安装未被 QA 使用。

QA **A=0.0.1、B=0.0.2**，与正式候选 **1.4.0** 分开。A/B 均在本轮候选构建输入上生成；应用源码相对合并基线不变。新输出目录和新 QA 测试密钥没有覆盖旧证据/密钥。复用旧 target 的独立复制缓存。原 QA 脚本的本机 DMG 封装失败后，使用仅将 macOS `app,dmg` 改为 `app` 的本地副本生成 A/B App、更新归档和签名；不改仓库 QA 脚本或产品。DMG 候选另取本轮成功 CI。

| 场景 | 观察及结论 |
| --- | --- |
| A 设置与样本 | 真实 UI 进入仅菜单栏，选择浅色机甲；仅周额度自动保存 `weekly`，无无效周期项。关闭自动更新检查。A 完整卡片显示合成周剩余 64%，统计样本输入 12,345 + 输出 678 = **13,023**；设置 20 项保留作比较 |
| 主动检查，未下载 | 11:29:19 主动检查发现 0.0.2；下载前回环服务器只收到 `/latest.json`，没有更新包请求。更新 UI 显示当前 0.0.1、新版 0.0.2 及下载按钮 |
| 真实下载和验签 | 11:30:12 点击“下载更新”，服务器首次收到 B archive 请求；官方 updater 真下载后 UI 显示“下载和验签完成，可以安装并重启” |
| 确认安装与自动重启 | 再点击“安装并重启”；A PID **14636** 退出，B 自动运行 PID **14724**。在重新绑定 UI 之前核对实际运行路径、Info.plist 0.0.2 与 B 主程序摘要完全匹配签名归档来源；不是前端刷新或工具额外启动 |
| 升级后使用 | `menubar` / `mecha-light` / `weekly`、全部 20 项设置逐项相等；合成统计行相等，schema 4、`integrity_check=ok`。完整卡片可恢复；总览与按模型读取 13,023，额度周页签正常显示该夹具没有已完成 Turn；原更新入口显示 0.0.2 / 已是最新 |
| 完整退出后冷启动 | 通过原生 Command-Q 完整退出 14724，进程不存在后用原 `start` 启动器启动为 **14780**。绑定 UI 前再次核对 B 摘要、设置及统计相同；完整卡片和更新入口仍可用，原生窗口显示 0.0.2 / 已是最新 |
| 缺少新增字段的旧侧边栏设置 | 停止 QA 后写入缺 `menubarQuotaDisplay` / `floatingPosition` 的隔离旧配置。B PID **15211** 保持 `sidebar`；原生设置显示左侧、110%、60%、Computer、自动检查关闭；没有强制改为菜单栏 |
| 更旧的无展示模式配置 | 再去掉 `displayMode`，B PID **15303** 按既有迁移默认保留 `floating`；真实浮窗可收起和展开，仍读取 13,023。没有强制改为菜单栏 |
| 清理 | 最后原生退出 QA，确认无 QA 进程，停止回环服务并确认端口不再监听。主工作区状态摘要及正式安装主程序摘要与开工一致；真实应用不受影响 |

安装路径为本轮 `qa/installed/Codex Monitor Updater QA.app`。A 主程序 SHA-256：`b7e33af794ec6e0eba97679fe006a686b8cdf89b5ce048441a5b72f685edb5af`；B：`593fb93d284db36ca4340a4c92d9e155995422ae16c521f4886d9e9c4293af8a`。B updater archive：`d4516dbfbff3353cfca978016b166626920c559f7d6ec5e89ad466eb810e8de4`。

界面操作来自真实 Tauri/WKWebView。工具 Reopen 用于恢复临时卡片，不当作物理托盘点击；托盘左右键仍引用此前用户验收。原生菜单 AX 偶发超时/失效 ID，通过 Escape、重新读取和键盘菜单导航恢复，不记为产品修复。最初手工统计夹具误用 `time_status=known` 导致统计不可读，已在退出 A 后改为仓库支持的 `dated`，随后才开始上述有效 A→B；这是夹具纠正，不隐去也不当作应用缺陷。期间自动锁屏后由用户解锁，最后旧浮窗展开检查已补齐。

本次证明隔离菜单栏设置及非空合成统计在升级和冷启动后保留，不扩大为真实历史数据库迁移、生产签名或全部硬件矩阵通过。

## 复用证据与尚未覆盖

- **复用：** [2026-10-13 在线升级](ONLINE-UPDATE-VALIDATION.md)与[合并验证](MAIN-MERGE-VALIDATION.md)的 Mac arm64 下载、验签、安装、重启及已通过失败场景。相对历史合并 `67b8629`，`updater.rs`、`UpdateWindow.tsx`、`src/lib/updater.ts`、`updater-qa.mjs` 和 `build.rs` 输入相同；没有整套重跑错误签名、中断、无效安装归档、清单错误等旧场景。
- **复用：** [菜单栏实施/收尾](MENUBAR-MODE-IMPLEMENTATION.md)记录的 R1、四皮肤、真实账户首次读取/手动刷新、面板关闭后正常五分钟刷新和重启偏好，以及两次功能 CI。没有重做菜单栏开发或全皮肤视觉验收。
- **待测：Windows 原生升级。** 当前只有 Mac 设备，没有已授权可用的 Windows 实机；CI 成功与安装包离线检查不算实机通过。沿用[Windows QA 手册](handoffs/20261013-online-update-windows.md)，源码改取本次准备分支精确候选 SHA，无需旧源码归档；补安装、升级、旧进程退出/新进程启动及设置/统计保留。
- **仍待相应条件：** Intel 实机、多屏/混合 DPI、睡眠、全屏 Space 等；此前未执行的取消安装、下载 URL 404 等仍未标通过。本轮未扩大硬件矩阵。
- **未验证：** 正式生产 updater 密钥对应关系、正式签名构建和 GitHub 发布；QA key 与 CI 编译不能证明这些条件。

## 检查与同源候选包

本地 `npm ci`、`npm run build`、`npm run check`、发布脚本 27/27、`npm audit --audit-level=high`（0 漏洞）、六处版本/锁项核对、`git diff --check` 均通过。初次 npm ci 因默认缓存无写权限失败，改用任务目录缓存后成功，未更改全局缓存或依赖。未重复本地全量产品测试；候选 CI 按现有门槛自动完整执行。

[候选 push CI 41572051917](https://github.com/bennick1/codex-monitor/actions/runs/41572051917)：`head_sha=2a3e34c81d7087a020b02130ccf2b2f26e1a4832`，`completed/success`，三个 job 全部成功。

| 检查 | CI 结果 |
| --- | --- |
| frontend | 26 文件 / 443 测试，构建，27 发布脚本测试，audit 0，通过 |
| macOS Universal | Rust 240 passed / 2 ignored，fmt / clippy，真实测试 signer/verifier 27 项发布测试，Universal 打包和上传通过 |
| Windows x64 | Rust 221 passed / 2 ignored，fmt / clippy，打包、GUI subsystem 校验和上传通过 |

制品保留至 2026-11-17，均已实际下载到本机 `outputs/release-prep-20261103/candidates/`，来源 SHA、字节数、ZIP digest 与 CRC 均核对。后续文档 HEAD 不重新命名这些包的来源。

| 候选 | 来源 / 实际检查 / SHA-256 |
| --- | --- |
| [Mac ZIP · 13201737414](https://github.com/bennick1/codex-monitor/actions/runs/41572051917/artifacts/13201737414) | 33,010,407 bytes；`36a93f26801b72d3d7ed0fca110da1fa292fb69177a0c88fb39331e8b1bf394f`；App plist 为 1.4.0 / `app.quotafloat.desktop`，主程序 `x86_64 arm64` |
| Mac DMG | `macos/dmg/Codex Monitor_1.4.0_universal.dmg`；`hdiutil verify=VALID`；`75d4b5409005bab51ce0400f8e600daa962bdcf8150e45e294f2aed8207d2188` |
| [Windows ZIP · 13202226637](https://github.com/bennick1/codex-monitor/actions/runs/41572051917/artifacts/13202226637) | 12,531,575 bytes；`dd0a294dabcf9fcc677aa05a004abcc215db4028535e1c8753bba2cb6cead6ef`；MSI 与 NSIS 均实际离线解出主程序，版本 1.4.0.0、x64、GUI subsystem 2 |
| Windows MSI | `windows/msi/Codex Monitor_1.4.0_x64_en-US.msi`；ProductVersion 1.4.0、Template x64；`26f5d2b9a7f4923712ace1f1426175896eda19995d3b2a9e57e7e74c941ee2e3` |
| Windows NSIS | `windows/nsis/Codex Monitor_1.4.0_x64-setup.exe`；x86 引导壳内为 x64 应用；`bdc88873f4d1e697a20449883d2aaff004b477fde3bfdd387e0c496c755e5ced` |

以上为**普通 unsigned CI 候选**，不是 Signed Release 或正式 updater 签名发布包。Mac 只有 linker ad-hoc 签名，未配置 Developer ID / notarization；Windows 安装器和主程序 PE 证书表为 0，没有 Authenticode。发布说明已披露 Gatekeeper / SmartScreen 等提示。平台证书采购不在本轮范围。

## 当前生产配置核实与阻塞

11:17:55 +08 通过 GitHub API 只读核查；认证身份对公开个人仓库有 admin 权限，但本轮没有操作配置。environment、仓库变量及 secrets 列表均成功返回 0，故以下缺失不是权限不足造成的未知。未读取私钥值，也没有复制认证文件。

| 配置 / 规则 | 当前可见结果 | 准确位置与负责方 |
| --- | --- | --- |
| `release` environment | 不存在；列表 `total_count=0` | 维护者：[Settings → Environments](https://github.com/bennick1/codex-monitor/settings/environments) 创建 `release` |
| 仅 main 部署 / required reviewers / prevent self-review | 随环境缺失；尚无该审核门禁 | 维护者：`release` → Deployment branches and tags，仅允许 main；Protection rules 设置 reviewers，套餐支持时禁止自审，并核对绕过规则 |
| `CODEX_MONITOR_UPDATER_PUBLIC_KEY` | 缺少，无 repository variable 兜底；没有可记录的公钥摘要 | 维护者：`release` → Environment variables |
| `TAURI_SIGNING_PRIVATE_KEY` | 缺少，无 repository secret 兜底 | 维护者：`release` → Environment secrets |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 缺少，无 repository secret 兜底 | 维护者：`release` → Environment secrets，值须匹配获批准的生产密钥配置 |
| main 保护 | `protected=false`；protection 返回 Branch not protected；active rules 与 rulesets 均为空 | 维护者：[Settings → Branches](https://github.com/bennick1/codex-monitor/settings/branches)，按项目规则设置 PR 审核、必需检查和绕过限制 |
| Windows 原生升级 | 待测 | 具备 Windows 设备的验收负责人，按上方 QA 手册完成并回填结果；不能由 CI 代签 |

生产密钥由维护者以获批准的材料配置；不得把本轮 QA key 用作生产 key，不由本任务生成或轮换。即使配置后来存在，也只代表存在性，不能提前写成正式签名已验证。是否接受尚未覆盖的平台风险需要维护者明确决策，本轮没有代为豁免。

## 批准后的发布入口

1. 维护者补齐生产 environment、三项配置、main 保护及审核，并补 Windows 原生验证；复核本文和实际发布说明，决定剩余硬件/系统签名风险是否可接受。
2. 审阅本准备 PR，批准并合入 main；核对合并 SHA 的 CI 终态、1.4.0 六处版本与最新 published Release/tags。准备 PR 合并授权与正式发布授权分别处理。
3. 获得正式发布批准后，进入 [Actions → Signed Release](https://github.com/bennick1/codex-monitor/actions/workflows/release.yml)，点击 Run workflow，分支仅选 **main**。也可在获批后执行 `gh workflow run release.yml --repo bennick1/codex-monitor --ref main`。
4. 按 `release` environment 要求审核 build/publish；工作流冻结触发 SHA，构建双平台、验签和内部身份绑定、组装唯一 manifest、创建 draft、上传完整资产、回读逐项核对后最终执行 `--draft=false --latest`。检查公开版本、资产、SHA256SUMS 和 latest.json；错误 draft 留给维护者处理，不手工公开不完整 draft，不删 tag 后盲目重跑。

**当前流程最终会公开版本，没有只构建或 dry-run 开关；不能用它试探签名配置。** 本任务止于准备分支和 PR。

## 本机可复核材料

统一目录：原主工作区下 `outputs/release-prep-20261103/`，均在忽略区，不提交日志、数据库、QA 私钥或安装包。

- `version-consistency.json`、`npm-ci-final.log`、`frontend-build.log`、`check.log`、`audit.log`、`release-notes-tests.log`：本次检查。
- `config-audit.json`：只读 API 的名称、存在性、权限和配置结论，不含密钥值；`CI-product.json`、`candidate-artifacts.json`：精确 CI / 制品与逐项摘要。
- `qa/ARTIFACTS.json`：A/B overlay、主程序/归档/签名摘要；`qa/proofs/` 中的 `A-before-check.json`、`requests-before-download.json`、`B-after-auto-restart.json`、`B-fully-exited.json`、`B-cold-start.json`、两类 legacy 记录、`native-observations.json`、`cleanup.json`：本轮状态链。
- `run-qa-build.sh` 与 `updater-qa-app-only.mjs`：本次本地 app-only 构建适配；`qa-evidence.py`：只操作固定隔离容器的合成样本、进程和摘要核验。复现时依 `UPDATER-QA.md` 在全新目录 prepare/build A/B，不覆盖现有 key、target 或 installed；仅在 QA 退出后写夹具，保持 CODEX_HOME 为空。
- `candidates/inspect-windows.py`：只用已有系统工具/标准库的离线 Windows 包检查。Windows 安装器未执行，无新增检查依赖。

旧 worktree、历史未跟踪材料、正式安装、真实账户和统计数据保留。本轮网络直连 fetch 失败后使用机器已有系统代理完成，未修改持久 Git 配置；提交和推送均为准备分支白名单及普通 push。

## CM-RELEASE-ENABLEMENT-20261103：生产配置与 Windows 接续

日期：2026-11-03，Asia/Shanghai。复用原准备 worktree 和 [PR #2](https://github.com/bennick1/codex-monitor/pull/2)。开工独立 fetch 后，准备分支/PR 为 `52cf581960e09a8fc01aa64a44c04ba57f447703`，main 仍为 `691f7dd1a9abe6bdb12bd0b2e81bb703775b40c1`，remote-only/local-only 为 0/0；没有重做版本准备或菜单栏开发。

维护者明确回复“无既有生产密钥”“审核安排待定”，并追加授权在 Windows CI 生成独立 A/B QA 安装包，供其安排人员在 Windows 实测。未授权连接其他电脑、增加协作者或授予权限。此前 Mac arm64 A→B、自动重启、冷启动、旧配置兼容及 13,023 Token 保留证据继续有效。

### 生产身份、保管与本地验证

- 开工重新核实全部 6 个 Release、17 个 tag，最新 published 仍为 `v1.3.1`（ID `403027234`），没有 `v1.4.0`。环境、仓库变量和 secrets 原为空；已发布资产没有 `latest.json` 或 updater `.sig`，v1.3.1 配置为 `createUpdaterArtifacts=false` 且没有 updater 公钥。旧 `release.yml` 的历史运行是当时 unsigned `Release Preparation`，不能凭其当前显示的工作流名称当作生产 updater 签名历史。
- 使用本项目已安装的官方 Tauri CLI **2.11.4** 首次生成独立加密生产私钥；没有使用 QA key、换钥或升级工具链。私钥在仓库外专用长期目录，目录权限 **700**、私钥 **600**。随机密码经关闭回显的交互输入送给官方 signer，单独存入本机 macOS Keychain；没有明文命令行参数、终端输出、Git、工单或候选包副本。
- 已从长期保存的加密私钥和 Keychain 重新取用密码完成签名，留下本机恢复说明。**独立离线备份尚未实际完成**；维护者须将加密私钥及密码保存到受控的独立恢复介质，并验证恢复。GitHub secrets 不能读取回来作备份。
- 公钥摘要为 SHA-256（对去除首尾空白的 Tauri base64 公钥 UTF-8 文本计算）：`25c31a8a881b7539005c55614897f06275396d6f1a25fb20efcd84af4d7d0ec4`。
- 固定本地文件 SHA-256：`dca930823e5c9d785b006eccb2368c9c6b739d02c17cd7e7765a07c17f7aedcb`。官方 signer 实签、项目现有 `verify_updater_signature`/`minisign-verify` 验签通过；篡改文件被拒绝，错误解密密码被拒绝。仅证明保存的密钥对和密码可配合使用；**没有签正式安装包、没有执行正式发布包签名或 Signed Release，没有在线生产升级验收**。

### GitHub 配置实际状态

本轮使用现有维护者身份 `bennick1`（仓库 admin）实施并回读。仅秘密值经 `gh secret set --env release --repo bennick1/codex-monitor` 的标准输入传入，在本地加密后提交 GitHub；回读仅查看 secret 元数据。

| 配置 | 实际结果 / 未完成部分 |
| --- | --- |
| `release` environment | 已创建，ID `26101575080` |
| 部署范围 | `custom_branch_policies=true`、`protected_branches=false`；仅一条 `name=main,type=branch`（ID `65316369`），没有标签或其他分支规则 |
| 公钥 variable | `CODEX_MONITOR_UPDATER_PUBLIC_KEY` 已存在，回读值摘要与上方生产公钥一致；2026-11-03 14:39:36 +08 写入 |
| 两个 environment secrets | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 名称和存在性回读通过，分别于 14:39:32、14:39:35 +08 创建；未读取 secret 明文；没有 repository 级兜底 |
| main 基础保护 | 已设置 PR 路径、`strict=true` 必需 CI 检查、`allow_force_pushes=false`、`allow_deletions=false` |
| main 人工审核 / 绕过 | **未完成**。当前 `required_approving_review_count=0` 仅表示先要求 PR，不要求人工批准；`enforce_admins=false` 保留管理员默认例外。批准数量、审核身份和禁止管理员绕过仍须维护者明确选择，不能将当前基础规则视为达到发布文档的人工审核要求 |
| environment 审核 / 自审 / 绕过 | **未完成**。没有 required reviewers，未启用 prevent self-review，`can_admins_bypass=true` 为创建后的默认值；待维护者指定且核实有权限的身份及相应规则。没有替维护者选择人员、邀请协作者或构造无法完成的自审流程 |

三个必需检查来自 `52cf581` 成功 check runs 的完整 API `name`，全部绑定 GitHub Actions `app_id=15368`。下面结尾的 `...` 是 GitHub 实际名称的一部分，不是本记录另行缩写：

```text
frontend
desktop (windows-latest, codex-monitor-windows-unsigned, npm run tauri -- build --config '{"bundl...
desktop (macos-latest, codex-monitor-macos-universal-unsigned, npm run tauri -- build --target un...
```

配置后 PR 仍 open/unmerged；原 HEAD 的检查成功，GitHub 显示 CLEAN，但这不是维护者发布批准。人工审核配置未完成、Windows 待验收、离线恢复备份未完成仍阻止正式发布。没有通过管理员绕过、关闭检查或强推推进 PR。`docs/RELEASE.md` 的 required reviewers / 禁止自审及禁止绕过审核要求没有降低；其“本轮只读”描述属于上一轮准备任务，不作为本轮执行授权。

### Windows 测试交付与未验收边界

当前执行设备仍为 macOS 27.0.1 arm64；没有连接 Windows 测试设备。维护者选择取得独立 A/B EXE 后安排人员实测。本轮 Windows CI 仅用于生成和校验隔离测试材料，**不能代签 Windows 原生 A→B 验收**。

测试材料使用当前准备分支冻结 SHA、独立 QA 标识/名称、Windows runner 本次生成的 QA key、空 CODEX_HOME、合成额度和非空合成统计，以及 `127.0.0.1:18765`。不使用旧源码归档，不传送生产私钥；普通 1.4.0 unsigned 候选继续保留原 `2a3e34c` 来源，不改称 QA 包或正式签名包。新的手动 QA 工作流通过既有 CI 的显式输入调用，普通 push/PR 的原有检查与名称保留；QA 专用 dispatch 不重复运行无关候选构建。

本轮 QA 工具最小修正：`updater-qa.mjs prepare` 改为直接调用已安装的官方 CLI，避免 Windows `shell:true` 经过 `cmd.exe` 丢失空密码参数。不修改产品、正式版本、依赖或发布工作流；新 A/B 包使用本轮更新后的 QA 工具生成。新增包只白名单复制安装器、公开签名/公钥、来源及操作脚本，不上传 QA 私钥、构建缓存、账户资料或数据库。测试端无需 Node/Rust/Python，使用系统 PowerShell 和 `winsqlite3.dll`，仅在已退出的独立 QA 数据库中插入合成样本。

首轮 Windows QA [41592693379](https://github.com/bennick1/codex-monitor/actions/runs/41592693379) 在 A 安装器/签名生成后，因包内 EXE 摘要与构建目录 EXE 不同被来源校验拒绝，未上传可交付包。核实 [Tauri CLI 2.11.4 官方 bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs)：NSIS 打包只将固定标记 `__TAURI_BUNDLE_TYPE_VAR_UNK` 改为 `__TAURI_BUNDLE_TYPE_VAR_NSS`，随后恢复构建目录原始 EXE。这是既有 Windows 发布来源记录遗漏打包转换的缺陷，也会影响正式 `record-release-environment.mjs`。本轮增加共享的严格推导函数供 QA 与正式来源记录使用：从实际 VERSIONINFO 已核对的原始构建字节推导唯一 NSIS 标记转换，分别记录原始和预期安装字节摘要；拒绝非 x64 GUI、缺失/多义标记及当前未支持的 Authenticode 输入。`inspectPayload` 仍对安装器内实际 EXE 作完整 SHA-256 相等检查，没有忽略任意字节或放宽签名/身份门槛。旧候选 MSI/NSIS 的标记差异只作根因佐证；修复后的 QA 包必须在新源码重新构建并通过 Windows 实际提取核对。

Windows 安装、主动检查前不下载、真实下载和验签、确认安装、旧/新进程及实际路径/版本/二进制来源、设置/统计保留、浮窗/侧边栏/系统托盘/更新入口、完整退出后冷启动、最后清理均保持 **待测试人员实测**。不要求 Windows 出现 macOS 专属菜单栏模式。测试人员应从当前包内步骤接续，并按 [Windows 手册](handoffs/20261013-online-update-windows.md) 与 [UPDATER-QA](UPDATER-QA.md) 回传脱敏结果；旧手册的源码归档与旧分支信息由本节当前来源替代。

Windows 真正通过之前，不修改 `docs/releases/1.4.0.md` 的待测说明。维护者完成审核安排、离线恢复备份并审阅真实 Windows 结果后，才能收敛正式发布决定；PR 合并与最终发布仍需分别明确授权。Signed Release 最终会公开 Release/latest，没有 dry-run，本轮未触发它。

第二轮 QA [41594332925](https://github.com/bennick1/codex-monitor/actions/runs/41594332925) 在构建前暴露新增任务错误地把完整发布测试中的 macOS tar/plist 用例放在 Windows 执行，因归档路径格式被安全校验拒绝。调整为 Windows QA 执行三项新增 NSIS 回归；原有 Linux frontend 和 macOS 签名归档步骤仍执行全部 30 项，没有跳过或降低原必需检查。此失败属于 QA 任务接线问题，不是 Windows 原生升级结果。

第三轮 QA [41595078604](https://github.com/bennick1/codex-monitor/actions/runs/41595078604) 的 A 已通过实际 VERSIONINFO、x64 GUI 及完整 NSIS 内部摘要核对；B 也已构建和签名，但既有 `updater-qa.mjs` 复制整个缓存 bundle，将仍留在缓存中的 A 安装器混入 B 快照，单包门槛再次正确拒绝。Windows 快照改为仅复制当前 QA 名称/版本对应的唯一 EXE 及其 `.sig`，拒绝覆盖既有快照，保留 A 和共享编译缓存；macOS 原逻辑不变。包收集器的唯一安装器检查不放宽。这三次失败及后续成功必须区分，失败诊断材料不是供人工验收的测试包。

第四轮 QA [41596807578](https://github.com/bennick1/codex-monitor/actions/runs/41596807578) 的 A/B 均已通过 Windows 版本、x64 GUI 和 NSIS 内部完整字节来源校验，随后打包前跟踪文件检查失败。锁定的 `tauri-build 2.6.3` / `tauri-utils 2.9.3` 会在应用及 verifier 构建时生成权限 schema；提交中的 Windows schema 比桌面 schema 多出五个已移除 process 插件权限条目。后续只接受 **未暂存的 `src-tauri/gen/schemas/windows-schema.json`，且新字节与本次 HEAD 已提交的 `desktop-schema.json` 完全相等** 这一已知生成结果，记录前后及预期摘要和差异；其余跟踪文件变化、暂存、重命名或删除继续阻止打包。没有 reset 隐藏差异，也没有忽略整个生成目录；实际下一轮结果另行核对。

普通 push CI [41596692901](https://github.com/bennick1/codex-monitor/actions/runs/41596692901) 首次在既有 Windows Rust 并发刷新测试中出现完成事件 generation=6、随后查询 generation=7 的时序失败，同源 PR CI [41596698380](https://github.com/bennick1/codex-monitor/actions/runs/41596698380) 已成功。只重跑失败的 Windows job 后 push CI 成功；没有改产品、测试断言或忽略项。保留这次波动记录，不扩大为原生升级缺陷或静默豁免检查。

第五轮 QA [41599679167](https://github.com/bennick1/codex-monitor/actions/runs/41599679167) 在 `563cc915968c8ddd93cf59c0c087bddc83efc93a` 完成 A/B 实际内部来源校验、精确生成 schema 校验、两个 EXE 的真实验签和包组装。Windows PowerShell 5.1 / `winsqlite3.dll` 已执行空目录、schema、源根限制、13,023 合成样本、重复拒绝和完整性检查；回环清单、B 字节下载和私有路径 404 也已执行，最后服务退出码断言失败，未交付测试包。[PowerShell 官方问题 #5421](https://github.com/PowerShell/PowerShell/issues/5421) 记录重定向输出的 `Start-Process -PassThru` 在未保留进程句柄时可能返回空退出码，与本次症状一致。修正 CI 观察进程的方式并增加构建前真实正常/异常退出码回归；继续要求服务确实退出、退出码为 0、端口不再监听，不将空退出码视为成功。测试端服务及 A/B 产品代码没有因此修改；成功与否以修复后完整运行结果为准。

第六轮 QA [41602579984](https://github.com/bennick1/codex-monitor/actions/runs/41602579984) 的 Windows PowerShell 5.1 退出码 0/7 前置回归已通过，随后因隔离复核发现下述问题主动取消，未交付旧包。[Tauri CLI 2.11.4 的 NSIS 模板](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/utils.nsh#L20-L43) 按 EXE 名称查找/关闭当前用户进程；QA 原先仅更换标识和产品名，仍与正式版共用 `codex-monitor.exe`，不足以保证安装时不影响正式进程。仅在 Windows QA overlay 使用既有官方 `mainBinaryName=codex-monitor-updater-qa`，使安装器、实际主程序、启动器和进程记录统一为 **`codex-monitor-updater-qa.exe`**。不改正式名称、Mac QA、产品源码或依赖。包内来源检查只允许与正式/QA 身份严格对应的唯一 EXE，拒绝两种名称混入、重复、路径逃逸或身份伪装，完整字节摘要要求继续保留；新增两项回归后完整发布脚本测试为 32 项。该 QA 构建输入已变化，因此最终 A/B 必须来自修复后的新源码，不能交付前述旧包。现有应用的 QA 启动检查先要求合成额度和空 `CODEX_HOME`，再启动统计服务；若 Windows 安装重启未保留环境，会拒绝启动，测试人员须如实回传，不能用启动器补启动冒充自动重启通过。

本机公开证据集中在原工作区 ignored `outputs/release-enable-20261103/`：`initial-audit.json`、`environment-created.json`、`main-protection-readback.json`、`production-key-proof.json` 及固定文件/签名；不包含私钥、密码或真实账户数据。精确成果 HEAD、Windows QA 制品来源、CI 终态和独立同步结果在本节完成交付记录及 PR 中核对。

### 本轮可交付结果（配置完成，正式发布待决）

实现及最终 Windows QA 来源：`1351ba6a47966a665e1ba1f708589e9a482e7f53`。同源 [push CI 41604078185](https://github.com/bennick1/codex-monitor/actions/runs/41604078185)、[PR CI 41604086442](https://github.com/bennick1/codex-monitor/actions/runs/41604086442) 和 [Windows QA 41604157789](https://github.com/bennick1/codex-monitor/actions/runs/41604157789) 全部成功。常规 CI 继续执行 443 个前端测试、32 个发布脚本测试、audit 0、Windows Rust 221 passed / 2 ignored、macOS Rust 240 passed / 2 ignored、fmt/clippy 及双平台打包；QA 专项 11/11、Windows NSIS 专项 5/5、PowerShell 语法和退出码 0/7 回归通过。没有手动重建未受影响的普通 unsigned 候选。

最终 QA 构建设备为 **GitHub Windows Server 2025 x64**（`windows-2025-vs2026`），Node **v22.23.4**、Rust **1.99.1**、官方 Tauri CLI **2.11.4**；辅助脚本实际由 Windows PowerShell 5.1 执行。A/B 均通过真实 VERSIONINFO、x64 GUI、独立 EXE 名称、官方 NSIS 标记转换后的完整安装字节来源和现有验签实现。唯一跟踪生成变化是前述 Windows schema，其当前/预期 SHA-256 均为 `bbcbbb4adac63c1591d4f299470566e8f70235e731f3904037952cd6a267126a`，实际差异保存在包内 `QA-SOURCE.json`，没有隐藏源码变更。

Windows helper 实际通过空 CODEX_HOME 拒绝规则、SQLite schema/源根限制、13,023 Token 合成样本、拒绝重复写入、完整性检查；回环服务器实际通过仅请求清单不取包、随后下载的 B 字节相等、非白名单路径 404、仅绑定 127.0.0.1、退出码 0 与端口关闭。**没有在 runner 安装或启动 A/B 应用，没有执行原生升级/UI 验收。**

| 交付物 | 可复核结果 |
| --- | --- |
| [完整 Windows A/B QA ZIP · 13216162301](https://github.com/bennick1/codex-monitor/actions/runs/41604157789/artifacts/13216162301) | 10,803,406 bytes；GitHub 保留至 2026-12-03 08:47:04 UTC。本机已实际下载；CRC、API ZIP digest、18 个文件白名单及全部内部摘要核对通过；仅公开安装器/签名/公钥、来源与操作工具，无私钥或数据库 |
| ZIP SHA-256 | `04d0ddfcca43431f76611536e984d2153ee5f09c8c618056274962594138aed9` |
| A 安装器 / 包内主程序 SHA-256 | `ee4a00f311112e63e3ef0b6d93ff1deeeaae66850377de4cbdcd966b5c86fd9e` / `0896b0cd2a3ddcf0120b9075447b1db8a7012132b609ef31ef23d7c8b33752a0` |
| B 安装器 / 包内主程序 SHA-256 | `cb8327e20fc4fdd5b9e19564f8667eae86c5cda06810cde95db06e0bba763c11` / `1d0f7a5ee3f173cc698f45a3138b5673ef0ba4853699aee2946de2d9e72be269` |
| 下载后的独立验证 | 在本机再次以包内 QA 公钥对 A/B EXE 和对应 `.sig` 使用原有成熟 verifier 验证，均通过；QA 公钥摘要与生产公钥不同。此复核不运行 EXE |

本机完整包在原工作区 ignored `outputs/release-enable-20261103/codex-monitor-windows-updater-qa.zip`，展开内容在同目录 `windows-qa-kit/`；`windows-qa-run.json`、`windows-qa-artifact.json`、`windows-qa-success.log`、`downloaded-qa-verification.json` 是公开证据。测试人员完整解压后从 **`README.zh-CN.txt` / `01-Install-A.cmd`** 接续；不要单独转发或直接运行 B。只需已授权的 Windows 10/11 x64、Windows PowerShell 5.1 和已安装 WebView2，不需 Node/Rust/Python。操作与反馈表均在该包中，证据写入独立 QA runtime 的 `evidence`。

Windows 实机仍待完成：A 安装/启动并保存展示设置、皮肤和非空合成统计；主动检查但未点击下载前无取包；真实下载/验签、单独确认安装；A 退出和 B 自动启动的 PID、实际路径/版本/二进制核对；设置/13,023 统计保留以及浮窗/侧边栏/托盘/更新入口；完整退出后冷启动复核；退出 QA/停止服务并确认正式安装及真实数据未覆盖。负责人为维护者安排的测试人员，维护者审阅回传；本轮没有用 CI 或解包代签这些结果，正式 release notes 继续保留待测。

当前正式发布决定为 **待决，不能发布**：维护者尚需指定已核实有仓库权限的审核身份、PR 批准数量、禁止自审与管理员绕过规则，并完成独立离线恢复备份；测试人员须完成上述 Windows 实测。既有 Intel/多屏/睡眠及 OS 提示等未接受风险保持原边界，须由维护者明确审阅。本轮已完成的是 **密钥配置和固定本地文件密钥验签**；**正式发布包签名、正式 CI 签名成功及在线生产升级均未执行/未验收**。合并与最终发布仍须分别授权，没有合并、tag、Release 或 Signed Release 操作。

实现提交正常推送后独立 fetch 确认为 0/0，main 保持 `691f7dd1a9abe6bdb12bd0b2e81bb703775b40c1`；准备 worktree 干净，原工作区 519 项历史未跟踪材料及其状态摘要未变。此后的本节交付记录是仅文档提交，不改变 QA 来源与已通过材料；最终记录 HEAD 的 CI、同步结果与 PR 状态在 PR #2 和最终交付再次独立核对，不把实现提交 CI 冒称最终记录提交的 CI。

### 维护者确认 Windows 验证完成（2026-11-03）

维护者在上述完整 Windows A/B QA 包交付后明确确认“windows验证完成”。据此，Windows 原生验证的当前状态更新为 **维护者确认完成**，从当前待测与发布阻塞事项中移除。本次证据类型为维护者人工确认；未新增逐项原始日志、设备型号或操作时间，不补造 PID、截图或测试记录，也不把 CI/安装包离线检查改写为实机验收。

本次确认关联上一节交付的完整 A/B QA 包：来源提交 `1351ba6a47966a665e1ba1f708589e9a482e7f53`，run `41604157789`，artifact `13216162301`，ZIP SHA-256 `04d0ddfcca43431f76611536e984d2153ee5f09c8c618056274962594138aed9`。不重复安排该轮 Windows 测试，也不因记录同步重新构建 QA 包。

当前仍需维护者落实的是 **人工审核安排**（PR 批准数量、environment 审核身份、自审和管理员绕过规则）与 **独立离线恢复备份**，并对既有 Intel/多屏/睡眠及系统签名提示等保留项作出正式发布决定。生产密钥配置和本地固定文件验签保持已完成；正式发布包签名、正式 CI 签名及线上生产升级仍未执行，不能提前记为通过。

本次仅同步本记录、1.4.0 Release Notes 和 PR #2 的 Windows 状态；应用源码、版本、依赖、QA 工具和工作流未改，既有构建与测试证据按其原来源 SHA 保留。PR 合并与正式发布仍待相应授权；没有合并、打 tag、创建 Release 或触发 Signed Release。

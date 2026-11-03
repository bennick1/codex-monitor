# Codex Monitor 1.4.0 发布准备

任务：`CM-RELEASE-PREP-20261103`。日期：2026-11-03，Asia/Shanghai。

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

Codex Monitor Windows 隔离升级测试包

用途：给真实 Windows x64 设备补测 A=0.0.1 → B=0.0.2。不是正式 1.4.0 发布包。
来源精确 SHA、CI URL、A/B 摘要和 QA 公钥摘要见 QA-SOURCE.json。
CI 只证明构建、包内二进制与 QA 签名检查通过，不证明原生安装/升级通过。
QA 私钥只在 CI 临时 runner 生成，不在此包；没有使用或附带生产私钥。
无 Authenticode 签名。按设备安全策略处理提示；不要关闭安全保护或管理员绕过。

准备
1. 使用维护者已授权的 Windows 10/11 x64 测试设备；记录系统版本、DPI、显示器数和 WebView2 条件。
2. 完整解压 ZIP 到一个新的本机目录，测试结束前不要移动目录。不要只发送单个 EXE。
3. 测试电脑只需要 Windows PowerShell 5.1 和现有 WebView2 Runtime，不需要 Node、Rust 或 Python。
4. 不使用真实 Codex 账号，不复制认证文件。不要从开始菜单启动 QA，也不要直接运行 B 安装器。
5. 脚本遇到已有 QA 安装、配置、数据库或目录会停止，保留旧资料；请联系维护者，不要自行删除。

执行顺序（双击相应 .cmd）
01-Install-A：核对显示的独立路径，输入 INSTALL QA，安装 A。
    安装采用固定 current-user QA 路径；脚本随后校验版本及二进制 SHA-256。
    正式应用标识 app.quotafloat.desktop 不被使用。QA 标识为 app.codexmonitor.updater-test.local。
02-Start-QA：真实启动 A。保存 Windows 支持的展示模式、皮肤、位置、透明度及自动检查设置；建议关闭自动检查。
    记录皮肤/模式/开关。通过 QA 系统托盘完整退出，确认 QA 消失。
03-Seed-Stats-and-Start-A：只在退出的独立 QA 数据库加入一次合成统计，再启动 A。
    总输入 12,345 + 总输出 678 = 13,023 Token；不是额度。CODEX_HOME 始终为空目录。
    在统计总览“全部”确认 13,023，并确认刚保存的设置。该样本没有已完成 Turn，Turn 页可为空。
05-Record-State：输入 A-before-check，保存 A 设置、统计事实、实际版本/路径、进程 PID 和设备条件。
04-Start-Update-Server：保持窗口打开。服务器只监听 127.0.0.1:18765，仅提供 B 和 latest.json。
    在 A 更新入口主动检查，应发现 B=0.0.2。先不要点击下载。
05-Record-State：输入 A-before-download。服务器窗口和记录此时应只有 /latest.json，没有 B 的 EXE 请求。
    再点击“下载更新”，观察真实下载及验签成功；单独点击“安装并重启”，记录安装器/UAC/SmartScreen 实际提示。
    核对旧 PID 退出、新 PID 启动，更新入口当前版本为 0.0.2，路径仍为独立 QA 路径。
    若更新器没有自动重启，先记录“未自动重启”及进程情况，联系维护者；不要先用启动器掩盖此结果。
05-Record-State：输入 B-after-restart。脚本会校验实际 EXE 与该包 B 二进制完全相同。
    比较 A/B 设置和 13,023 合成统计；检查悬浮窗、侧边栏、系统托盘和更新入口。Windows 没有 macOS 菜单栏模式。
    通过 QA 托盘完整退出，确认进程消失；再次用 02-Start-QA 冷启动。
05-Record-State：输入 B-cold-start，再核对版本、设置、统计、窗口/托盘/更新入口。
    最后通过 QA 托盘完整退出。
06-Stop-Server-and-Check：核对 QA 进程已退出，停止本包回环服务，确认 18765 不监听；保留全部 QA 材料。

证据与回传
脚本证据：%LOCALAPPDATA%\CodexMonitorUpdaterQA-CM-RELEASE-ENABLEMENT-20261103\evidence
请把 evidence 目录与下方填好的真实操作结果交给维护者；无需回传任何真实账号数据或密钥。
不要因为脚本未报错就填写“全部通过”；工具未操作、提示未观察或条件缺少的项目须写“待测”。

测试人/日期：
系统版本与架构、DPI/显示器、是否普通用户：
WebView2 条件：
来源 SHA（QA-SOURCE.json）：
A 安装/启动、保存的设置与皮肤、13,023 统计：
下载前仅检查无取包（A-before-download 与 requests.jsonl）：
真下载/验签、单独确认安装、系统提示：
A 旧 PID / B 新 PID、实际路径、自动重启是否发生：
B 设置/统计保留、悬浮窗/侧边栏/托盘/更新入口：
完整退出后冷启动、版本与持久化状态：
QA/服务器退出、正式安装与真实数据是否保持原状：
失败或待测项、具体步骤、脱敏截图：

本包覆盖本轮正常升级链路接续。取消安装、错误签名、网络中断等扩展场景仍按仓库 UPDATER-QA.md 另行安排，不能由此包普通成功链路代签。

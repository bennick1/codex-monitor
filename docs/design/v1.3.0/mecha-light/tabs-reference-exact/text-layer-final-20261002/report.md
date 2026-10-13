# CM-130-TABS-TEXT-LAYER-FINAL-20261002

**Mecha Tabs 三色直接参考：Human Accepted。总览选中／按模型选中交互派生：Human Accepted。文字层与面板实现：Frozen — 用户明确签署。**

2026-10-02，用户明确确认：“Mecha Tabs 三色原图还原及交互派生视觉验收通过。” 签署对象为本地最终文字层实现，不是远端旧 Candidate 或 Round 2/3。完整冻结清单与归档核验见 [acceptance-archive.json](acceptance-archive.json) 和 [accepted-files.sha256](accepted-files.sha256)。

任务书已从提交 `3e93c53d97c374ac8bea2a042662f281375ce313` 完整读取。文字层开发时位于原分支 `feat/v1.3.0-fast-opacity-mecha-skin`，起始 HEAD 为 `1980d03`。归档阶段已无冲突 fast-forward 吸收两份任务文档至 `3e93c53`，验收实现未被覆盖。会话初始 detached 工作树未切换、未写入实现。任务文档快照保留在 `outputs/v1.3.0-tabs-text-layer-final/task-read-from-commit.md`。

## 资产方式与映射

采用 **background-bound label patch（背景绑定局部文字合成补片）**，没有声称从合成 PNG 恢复了独立透明文字层。资产只覆盖原记录文字修补区域，未扩大诊断 mask；原图归一化、18 张既有板面、轮廓、切角、接缝、灯边、底边与 33px 布局全部保留。

18 张小补片映射为 3 色 × 3 标签键 × active/idle。`overview/models/turns` 始终对应「总览／按模型／额度周」。每张资产记录 locale、labelKey、sourceState、renderState、panelBackgroundId、原始与归一化坐标、尺寸及 SHA-256。清单见 [label-patches.json](label-patches.json)，生产清单位于 `assets/mecha-light/tabs-reference-exact/label-patches.json`。

直接场景保留对应源图的完整合成字形与白边；派生场景在对应目标板面上进行背景适配，保留源笔画与白边，不把另一种颜色的整块背景搬过来。派生使用的背景透过率是对比度估计，不是原始 alpha，也不代表恢复了未知原始选中样式。来源为本项目批准生成图，不冒称 Exo 2/OFL 字形。

## 三色完整区域比较

真实 QuotaCard → TokenUsage 生产组件，合成数据输入。Chromium 154.0.8037.58；DPR1、100%整体不透明度、100%缩放、无 hover/focus。每色完整 258×36 = 9,288 像素，未遮罩、未修图、未裁减。

| 直接参考：额度周选中 | different_pixels | max_channel_delta |
| --- | ---: | ---: |
| 蓝色 | 0 | 0 |
| 黄橙 | 0 | 0 |
| 红色 | 0 | 0 |

最终 [差异统计](differences.json) 与 [Actual / Reference / Overlay / 绝对差异](index.html) 均可复核。源证据在 `../text-layer-three-colors-02/`。新基线实际重跑复现 1043/1040/1060；蓝色最小闭环先实现零差异，再扩到三色。历史 `iteration-05`、新基线与全部失败结果保留。

## 交互派生与回退

「总览选中／按模型选中」及 hover/focus **没有直接原图**。已保存三色真实截图，并核对标签不串位、真实内容、pressed 状态、图片不截获点击、Enter/Space、焦点框与中文/英文切换；不把这些状态列入直接参考零差异。

第一版暖色派生笔画偏青，保留在 `../text-layer-three-colors-01/`，含当时生成器与资源归档。第二版修正背景匹配，最终派生截图位于 `../text-layer-three-colors-02/`；用户已明确签署交互派生视觉验收通过。

三个真实 button 与语言表文本 span 保留，mode 不从图片或显示文字推断。只有中文 Mecha 且补片与对应板面解码成功时才视觉隐藏真实文本。英文、其他皮肤、unknown 板面、映射缺失、资源丢失/损坏、尚未解码均使用真实文本。旧语言、皮肤、颜色或选中状态的异步解码不会隐藏新标签。图片 alt 为空、aria-hidden、不可拖拽、pointer-events:none；可访问名称只有一条路径。

forced-colors 下显示真实文字。固定字图对字体替换、仅文字放大和个性化前景色存在限制，不能宣称与字体渲染完全等价或全套 WCAG 通过。DPR1/2 和普通 Chrome 100%/125%/200% 缩放分别留证；放大仍是 1× 位图插值，不是高分辨率文字。

## 回归与冻结项

- 原有作用域回归：117 组全通过，外部区域零像素变化、其他三皮肤及五个 period 按钮像素/样式不变；6 组点击/键盘交互通过。
- 补充浏览器检查：30 项通过，覆盖 DPR1/2、名称恰好一次、加载失败/损坏、语言/皮肤/颜色/选中竞态、unknown、forced-colors、三色60%整体淡化仅一次。另有6组hover/focus检查通过。
- Full 标题/Tabs/内容 y=299/319/355；Compact y=245/265/301。Widget 306px、Tabs 33px、三色分片宽度和数据区坐标不变。
- 前端18文件/272测试通过，新增8项标签测试通过；原 Mecha 布局323、键盘4项断言未放宽并全部通过；build与git diff --check通过。
- 浏览器证据在 `../text-layer-validation-01/`、`../text-layer-hover-focus-01/`、`../text-layer-scope-01/`；构建与测试日志位于 `outputs/v1.3.0-tabs-text-layer-final/`。构建第一次因新增测试选项类型错误失败，原日志保留；修正后build-02通过。
- 以上自动化不代表 macOS/Windows Tauri 宿主、原生读屏器或完整无障碍标准验收。视觉人工验收另据本次用户明确签署记录；Fast、原生透明度及双端安装包等其他人工验收状态未改变。

## 保护、签署与最终 Candidate

新保险包保护350个未提交文件及共1,577个实现/证据文件，归档回读SHA-256通过。1,571个受保护文件仍逐字节一致；6个修改文件的旧版本保留于保险包。旧75文件保险包、全部历史证据、冻结原图/清单/归一化参数/诊断mask和18张板面均未改动。详见 [work-preservation.json](work-preservation.json)。

直接参考及交互派生的视觉签署已完成。[对照页](index.html) 作为已验收证据保留，不重复要求用户签署同一浏览器图。完整零差异只适用于上述指定 Chromium、DPR1、100%缩放/不透明度、无Hover/Focus、三色额度周选中的完整258×36区域，不推广至所有平台、DPR、缩放及交互状态。

文字层开发阶段未提交、未推送、未出 Candidate 的历史记录保留。本次用户已授权归档、正常逻辑提交、普通推送及现有 CI 双端 Candidate 交付；不 reset、stash、强制 checkout、amend、squash 或 force push。最终提交为 v1.3.0 Candidate Build Source，exact SHA、CI 和包完整性见独立交付目录 BUILD-INFO.txt。仅工程与制品核验全通过后标记 Ready for v1.3.0 Final Native Human Acceptance。

原生宿主仅复验与已签署 Tab 一致及打包回归；Fast 真实开/关 A/B及重启保持、四皮肤整体透明度及偏好恢复、原生Hover/拖动/停靠/滚动、双端安装/启动/退出/重启继续此前待验收状态。原始两条缺可信Fast证据记录仍为Unknown。Windows同事仅正常使用安装包反馈。不自动安装、不写生产数据库，不合并main、不创建Tag、不发布Release、不修改v1.2.1及此前发布资产。

续作入口：本目录 report/summary、生产 label-patches.json，以及最新三个证据目录。启动真实组件预览：`MECHA_PREVIEW_PORT=1436 node scripts/preview-mecha-tabs-exact.mjs`；新截图必须选新 phase，不覆盖现有结果。


## 2026-10-02 归档工程复核

[归档复核摘要](archive-recheck.json)：前端18文件/272测试、标签浏览器36项、作用域117组/交互6组、Mecha布局323项/键盘4项、四皮肤整体不透明度252组、updater-policy、构建及diff检查通过。本机Chrome已更新为154.0.8037.93，保持指定DPR1/100%缩放/100%不透明度/无Hover和Focus条件，完整三色直接参考仍0差异；三色×三模式共9张Tab截图与已签署版本逐字节一致。该重跑与原154.0.8037.58证据分开记录，不扩张原结论。103个冻结文件构建前后全部逐字节一致；未运行资源生成器。

当前有效验证入口是 `capture-mecha-tabs-exact.mjs`、`compare-mecha-tabs.py`、`test-mecha-tabs-exact.mjs`、`test-mecha-tabs-text-layer.mjs` 及既有布局/键盘/不透明度脚本；Round 2/3 的预览和检查保留为历史，不作为最终实现。复跑 capture/label 必须选择全新phase。作用域测试可将 `MECHA_BASELINE_CSS` 指向本目录的 `scope-baseline-mecha.css`，将 `MECHA_REGRESSION_OUTPUT` 指向全新输出目录；需要既有Playwright/Chromium与Pillow/NumPy运行时。没有新增CI验证外壳、依赖或workflow。既有布局/键盘/不透明度脚本复核时仅在内存中重定向输出路径，原脚本及断言未变；原SHA及完整日志在本地独立归档outputs目录。

历史预览、失败详情及诊断仍保留在原目录和两份既有保险包/最终增量中；Git仅收录正式实现、生产映射、有效验证入口、已签署对照、必要历史失败摘要和验收记录，不提交全部诊断、保险包或构建产物。

## 2026-10-02 最终原生验收与发布 provenance

用户在固定 Candidate `98158b9df4c731ac486886f27a10b54b0672327c` 的双端安装包交接后明确确认：“人工验收完成，无问题。” 据此记录 **Final Native Human Acceptance：Passed**；本报告此前三色直接参考及交互派生的视觉签署与实现冻结不变。历史 Pending 保留为当时记录，不再作为本次最终验收状态。

正式 [Codex Monitor v1.3.0](https://github.com/bennick1/codex-monitor/releases/tag/v1.3.0)，Release ID `401944221`，发布时间 `2026-10-02 23:49:59 +08:00`，`draft=false`、`prerelease=false`；annotated tag object `b80181691647d4a6f7c8ecdb75f963e9a5bff1e0`，target `98158b9df4c731ac486886f27a10b54b0672327c`。安装包唯一来源为 [Candidate CI 37021024626](https://github.com/bennick1/codex-monitor/actions/runs/37021024626)；main 同 SHA [CI 37026558975](https://github.com/bennick1/codex-monitor/actions/runs/37026558975) 成功。原 ZIP、实际验收包、正式改名包和远端回下载逐字节一致；完整资产 size／SHA-256、签名状态及文档收口见 [v1.3.0 功能验证报告](../../../../../v1.3.0-feature-validation-report.md)。

本次仅追加发布事实，不修改资源、冻结哈希、截图、原始对照环境或像素结论。中文固定字图、原生读屏器／完整 WCAG 未独立验收、Fast selected/requested 与两条历史 Unknown 等限制继续保留；原生人工通过不扩大任何既有自动化或零像素差异结论。

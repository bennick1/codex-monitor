# Token 数字展示优化报告

日期：2026-09-05。环境：macOS arm64。基线：`9d5095e`，开始时工作区干净。

已完成摘要中文单位、详情千分位格式化，并在本轮构建的 macOS `.app` 中核对实际显示。范围限定为 Token 数字展示及其验证。

## 修改文件

| 文件 | 修改内容 |
| --- | --- |
| `src/lib/tokenFormat.ts` | 复用统一工具；`formatTokenCount` 输出摘要，新增 `formatTokenCountExact` 输出完整千分位，共用十进制字符串校验与 BigInt 解析 |
| `src/components/TokenUsage.tsx` | 四个周期摘要接入中文单位，现有悬停／键盘焦点详情及可访问性标签接入完整千分位；超长摘要增加专用样式类 |
| `src/styles.css` | 仅调整 Token 数字：限制在格内，超过 10 个字符的摘要使用 12px 字号并允许换行；存在超长值时压缩 Token 区域内的两处间距，为第二行留空间 |
| `src/lib/tokenFormat.test.ts` | 两种格式、单位边界、四舍五入、无效值、前导零及大整数测试 |
| `src/components/TokenUsage.test.tsx` | 更新展示断言，增加中英文环境下的摘要／详情对应、键盘可达及原始值保留检查 |
| `src/App.test.tsx` | 更新完整数值可访问性标签断言，保留原有 hover、状态与 quota 隔离回归 |
| `src/test/tokenLayout.tsx` | 合成排版数据覆盖需求示例、万单位上界及超大整数 |
| `scripts/test-token-layout.mjs` | 在原排版检查上增加详情 hover／focus 可见性、千分位及边界检查 |
| `docs/token-display-format-report.md` | 本报告 |

## 格式规则

- 摘要：小于 `10000` 显示整数原值，不加千分位；`10000 ≤ 值 < 100000000` 使用“万”；`值 ≥ 100000000` 使用“亿”。有单位时固定保留两位小数，按四舍五入处理。
- 单位根据**四舍五入前的原始值**确定。因此 `99999999` 显示 `10000.00万`，到 `100000000` 才显示 `1.00亿`。
- 详情：始终显示完整整数，每三位添加英文逗号，不转换万／亿、不使用科学计数法。现有详情提示继续支持指针和键盘焦点。
- 输入仍为接口提供的十进制字符串；计算全程使用 BigInt，不经过 Number，避免大整数精度丢失。`0` 保持为 `0`，无效或缺失输入保持为 `—`；组件原有扫描占位规则不变。
- 中英文界面使用同一套数字规则，标签仍沿用原有语言设置。

| 原始值 | 摘要 | 详情 |
| --- | --- | --- |
| `0` | `0` | `0` |
| `9999` | `9999` | `9,999` |
| `10000` | `1.00万` | `10,000` |
| `99999999` | `10000.00万` | `99,999,999` |
| `100000000` | `1.00亿` | `100,000,000` |
| `12685398` | `1268.54万` | `12,685,398` |
| `1300000000` | `13.00亿` | `1,300,000,000` |
| `9007199254740993` | `90071992.55亿` | `9,007,199,254,740,993` |
| `9223372036854775807` | `92233720368.55亿` | `9,223,372,036,854,775,807` |
| `18446744073709551615` | `184467440737.10亿` | `18,446,744,073,709,551,615` |

## 测试结果

| 验证 | 结果 |
| --- | --- |
| `npm test` | **82 passed / 11 files**；其中格式化 26 项、Token 组件 15 项。原有状态、时间展示、请求协调和 quota 隔离测试通过 |
| `npm run build` | **通过**；TypeScript 与 Vite 正式构建通过，最终 Tauri 打包再次执行 |
| 合成数据排版与详情测试 | **112/112 通过**：80 项中英文 × 明暗主题 × 5 种 Token 状态 × 4 种 quota 状态排版检查，另有 32 项详情 hover／focus 检查；包含 partial/stale、单位边界与超大整数 |
| `git diff --check` | **通过** |
| macOS release `.app` 构建 | **通过**，最终 Rust release 编译及 app 打包成功；未重新执行完整 Rust 单元测试，因为后端源码无修改 |
| 原生实际显示 | **通过**：CUA 在最终 `.app` 中展开卡片，截图与可访问性文本均显示四项真实 Token 摘要为中文单位；逐项进入今日、本周、本月、总计，实际看到完整千分位详情，无万／亿缩写、无裁切 |
| 原生摘要与完整值核对 | 同一次完整原生可访问性快照中，以四项完整数值独立进行 BigInt 换算，摘要 **4/4 一致**，千分位格式 **4/4 通过**；这是界面快照核对，未单独捕获 IPC 响应 |
| 原生更新及状态 | 同一进程观察到扫描结束后数值继续更新，partial 星号和“统计不完整”保留；stale 等其他状态由自动测试覆盖 |

初次排版验证实际发现极大整数转换成“亿”后横向溢出；加入仅针对 Token 超长数字的兜底后，最终 112 项全部通过。卡片尺寸、四格结构、普通数值字号及其他 UI 保持原状。

真实数据本次四项均位于“亿”区间，因此 `0`、万区间、单位边界和极大整数依靠合成测试验证；未为了实机造数修改数据库。原生截图核验覆盖当前中文浅色界面，中英文／明暗主题的组合验证来自合成排版测试。图形工具通过坐标点击进入悬浮球和数字完成观察，未将其称为无点击的纯悬停手工验收。

## 本机验证产物

- 最终应用：`/Users/bennick/Work/Codex/codex-monitor/outputs/token-display-format/Quota Float.app`。
- 进程路径核对：PID `92769`，实际执行文件来自上述应用的 `Contents/MacOS/quota-float`，排除了旧包混淆。
- 执行文件 SHA256：`543403c46585a6460d3d8fc2482057f64672b74c6bbdbc5e286d29bd0253b15f`。
- 构建来源及源码 SHA256：`outputs/token-display-format/source-checksums.json`、`outputs/token-display-format/build-origin.json`。
- 单元测试日志：`/private/tmp/codex-monitor-token-format-tests.log`；最终 app 构建日志：`/private/tmp/codex-monitor-token-format-app.log`。
- 合成截图与排版结果：`outputs/token-ui-layout/`。本轮原生截图与 AX 核验记录保留在任务工具输出中；不将真实用量数值、会话或数据库写入报告及测试夹具。

最终打包命令：

```sh
PATH=/private/tmp/codex-monitor-cargo/bin:$PATH \
CARGO_HOME=/private/tmp/codex-monitor-cargo \
RUSTUP_HOME=/private/tmp/codex-monitor-rustup \
node_modules/.bin/tauri build --bundles app --no-sign \
  --config '{"identifier":"app.quotafloat.token-ui-qa-20260905","bundle":{"createUpdaterArtifacts":false}}'
```

排版复验命令使用本机已有浏览器，无新增项目依赖：

```sh
PLAYWRIGHT_MODULE_PATH=/Users/bennick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/Users/bennick/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node scripts/test-token-layout.mjs
```

沿用既有 QA identifier 与临时配置／缓存映射，真实采集继续走现有实现。后端统计、SQLite 结构及读写代码、Tauri command、接口与字段、时间口径、partial/stale 判定、quota 逻辑、依赖和正式打包配置均无改动。没有直接操作数据库，也未发布应用或进入其他 UI 改造。代码及本报告按用户后续指令提交至现有 GitHub 仓库 `bennick1/codex-monitor` 的 `main` 分支。

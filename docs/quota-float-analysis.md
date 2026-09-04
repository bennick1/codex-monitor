# quota-float 源码分析

## 1. 分析范围与基线

本文是 Codex Monitor V1.0 开发流程的 Step 1 产物，只描述当前 quota-float 基线，不包含 Token Statistics 的数据源调研、详细设计或实现。

- 仓库：`https://github.com/bennick1/codex-monitor`
- `origin`：`https://github.com/bennick1/codex-monitor.git`
- `upstream`：`https://github.com/change-42-yhmm/quota-float.git`
- 当前分支：`main`
- 当前提交：`3e3848f4161b912166dcde98fcb94efb3630ddde`
- 当前版本：`0.2.4`
- 分析时状态：工作树无未提交改动；`HEAD`、`origin/main`、`upstream/main` 指向同一提交

当前代码仍使用 `quota-float` / `Quota Float` 的包名、crate 名、窗口标题、应用标识、更新地址和发布配置。Codex Monitor 的产品重命名尚未发生。

## 2. 项目目录结构

```text
codex-monitor/
├── .github/workflows/
│   ├── ci.yml                    # 前端、Rust、Windows/macOS Tauri CI
│   └── release.yml               # tag 触发的 Windows/macOS 发布
├── assets/                       # 默认外观、Blur/Computer 皮肤、字体和图标
├── docs/                         # 发布、测试、隐私、设计交接等文档
├── scripts/                      # Codex 更新兼容性检查、macOS 冒烟截图等脚本
├── src/                          # React/TypeScript 前端
│   ├── App.tsx                   # 应用状态、刷新调度、悬浮球/卡片切换
│   ├── main.tsx                  # React 入口及预览/支持者页面分流
│   ├── styles.css                # 悬浮球、展开卡片、状态及皮肤样式
│   ├── types.ts                  # 前端数据契约
│   ├── components/
│   │   ├── QuotaCard.tsx         # 展开卡片与折叠悬浮球
│   │   ├── ProviderMark.tsx      # Codex 标识
│   │   ├── SupporterPanel.tsx    # 支持者皮肤窗口
│   │   └── DesignPlayground.tsx  # 浏览器设计预览
│   └── lib/
│       ├── bridge.ts             # Tauri command/event 适配层及浏览器 mock
│       ├── snapshots.ts          # 新旧 quota snapshot 合并和 stale 回退
│       ├── format.ts             # 百分比、reset 时间和状态格式化
│       ├── i18n.ts               # 中英文案
│       ├── desktopPalette.ts     # 明暗主题状态色板
│       └── appUpdate.ts          # Tauri 更新检查和安装流程
├── src-tauri/                    # Rust/Tauri 2 后端
│   ├── src/
│   │   ├── main.rs               # 桌面二进制入口
│   │   ├── lib.rs                # Tauri 初始化、状态、commands、窗口和托盘
│   │   ├── codex.rs              # Codex 认证读取、quota 请求和响应解析
│   │   ├── models.rs             # Rust 序列化模型与偏好设置
│   │   └── license.rs            # 支持者皮肤的本地许可证校验
│   ├── capabilities/default.json # widget 窗口的 Tauri 权限
│   ├── tauri.conf.json           # 窗口、打包、CSP 和 updater 配置
│   ├── Cargo.toml                # Rust 依赖
│   └── build.rs
├── tools/                        # 许可证签发和维护者工具，不在主运行链路
├── package.json                  # Vite/React/Tauri 前端命令与依赖
├── vite.config.ts
├── tsconfig.json
├── PRIVACY.md
├── SECURITY.md
└── README.md
```

## 3. 技术栈与 Tauri 架构

### 3.1 前端

- React 19 + TypeScript 5.9
- Vite 7
- Tauri JavaScript API 2.x
- Phosphor Icons
- Vitest + Testing Library
- 单页入口 `src/main.tsx` 根据 URL 查询参数切换三个渲染入口：主 widget、设计预览、支持者皮肤页

### 3.2 Rust 后端

- Rust 2021 edition
- Tauri 2
- `reqwest` + rustls：访问 Codex/ChatGPT quota 接口
- `serde` / `serde_json`：配置和响应解析
- `chrono`：reset 时间处理
- `tokio`：异步请求、并发请求和刷新互斥
- `dirs`：定位用户目录
- Tauri 插件：single-instance、autostart、window-state、updater、process、opener

当前没有 SQLite 依赖、数据库初始化逻辑、Codex session 文件扫描模块或 Token 统计模型。

### 3.3 桌面窗口

`src-tauri/tauri.conf.json` 预定义两个窗口：

1. `widget`
   - 无边框、透明、不可调整大小、默认置顶、跳过任务栏
   - 配置尺寸为 80 × 80，最大 314 × 314
   - 显示主悬浮球和 Hover 展开卡片
2. `supporter`
   - 独立普通窗口，默认隐藏
   - 用于支持者皮肤授权和选择

Rust 中可见内容尺寸常量分别为 72 和 306 逻辑像素；窗口四周再保留 4 逻辑像素透明安全边距，因此对应 80 和 314 的窗口占位。窗口扩缩、屏幕边界限制、吸附和多显示器缩放均由 Rust 处理，而不是只通过 CSS 放大页面。

### 3.4 Tauri 初始化

`src-tauri/src/main.rs` 仅调用 `quota_float_lib::run()`。`run()` 完成以下工作：

1. 注册 opener、process、updater、single-instance、autostart、window-state 插件。
2. 从 Tauri app config 目录读取 `preferences.json`，异常时尝试 `.json.bak`，再回退安全默认值。
3. 初始化 12 秒超时、禁止重定向、启用系统代理的 `reqwest::Client`。
4. 创建共享 `AppState`，保存 HTTP client、偏好设置、刷新锁、30 秒 snapshot 缓存、窗口几何状态等。
5. 创建 Tray 菜单；失败时让 widget 回到任务栏，保留操作入口。
6. 恢复锁定、置顶、窗口位置和皮肤状态。
7. 注册前端可调用的 commands。
8. 拦截窗口关闭事件，改为隐藏窗口；应用恢复时向 widget 发送刷新事件。

单实例插件会在重复启动时显示并聚焦既有 widget。

## 4. 前后端关系

前端不直接读取 `~/.codex/auth.json`，也不直接访问网络。所有敏感认证读取和 quota HTTP 请求均在 Rust 端完成。

### 4.1 Command 边界

`src/lib/bridge.ts` 封装 Tauri `invoke`：

| 前端方法 | Rust command | 作用 |
| --- | --- | --- |
| `fetchSnapshots(false)` | `get_snapshots` | 读取 30 秒缓存或获取 quota |
| `fetchSnapshots(true)` | `refresh_snapshots` | 强制绕过缓存刷新 quota |
| `setWidgetExpanded(true)` | `expand_widget` | 根据工作区和吸附状态展开窗口 |
| `setWidgetExpanded(false)` | `collapse_widget` | 收回悬浮球并恢复/修正位置 |
| `startDragging()` | `begin_widget_drag` / `finish_widget_drag` | 标记拖动模式并在结束后吸附 |
| 偏好设置方法 | `get_preferences` / `set_preferences` 等 | 读写本地 widget 设置 |
| 支持者方法 | license/skin commands | 本地校验许可证并切换皮肤 |

浏览器环境没有 Tauri 时，`bridge.ts` 返回静态 quota mock，供设计预览和前端开发使用；该 mock 不是桌面应用真实数据。

### 4.2 Event 边界

Rust Tray 和生命周期事件通过 Tauri event 驱动前端：

- `refresh-requested`：立即刷新 quota
- `update-check-requested`：手动检查更新
- `preferences-changed`：同步语言、主题、置顶、展开等设置

前端保存偏好失败时会恢复保存前状态。Rust 端会过滤来自渲染进程的许可证/皮肤字段，避免前端 payload 直接解锁付费皮肤。

## 5. Codex quota 获取流程

### 5.1 认证文件定位与读取

`src-tauri/src/codex.rs` 按以下顺序定位认证目录：

1. `CODEX_HOME`
2. 用户主目录下的 `.codex`

最终读取 `<目录>/auth.json`。读取时要求目标是普通文件且不超过 256 KiB。代码兼容根对象或 `tokens` 子对象，并兼容以下字段：

- access token：`access_token` / `accessToken`
- account id：`account_id` / `accountId`

若 auth 文件没有 account id，会尝试从 access token 的 JWT payload 中读取 ChatGPT account id。token 和 account id 只保留在函数内存对象中，没有写入应用配置或日志。

### 5.2 HTTP 请求

认证成功后，Rust 并发请求：

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

请求携带 Bearer token、Codex Desktop originator、Codex product SKU，以及可用时的 ChatGPT account id。敏感 header 被标记为 sensitive。HTTP client 禁止重定向、超时 12 秒；每个响应最大读取 1 MiB。

quota 主请求失败会直接形成失败 snapshot：

- 401/403 → `signed_out`
- 429 → `unavailable`，提示稍后自动重试
- 其他 HTTP、网络或解析失败 → `unavailable`

reset-credit 请求是辅助数据；其失败不会使已成功的 quota 主结果失败。

### 5.3 quota 响应解析

解析器兼容 snake_case、camelCase 和多种历史字段名：

- 可直接读取 remaining percent/ratio；只有 used 值时按 `100 - used` 转换
- ratio 型数值会换算为百分比
- 最终百分比限制在 0～100
- reset time 兼容字符串和 Unix 秒时间戳
- window duration 兼容多种字段名
- 优先按已知名称找窗口，也能在数组型 `windows` / `limits` / `buckets` 中按名称或时长寻找

5 小时窗口按约 18,000 秒识别，周窗口按约 604,800 秒识别，容许 60 秒误差。如果两个窗口都无法识别，返回 `unavailable`，不会构造虚假数值。

成功结果序列化为 `ProviderSnapshot`：

```text
provider
displayName
plan
shortWindow { remainingPercent, resetsAt, windowSeconds }
weeklyWindow { remainingPercent, resetsAt, windowSeconds }
resetCredits
resetCreditExpiresAt
updatedAt
status
message
```

### 5.4 缓存与并发控制

- `get_snapshots` 使用 Rust 内存缓存，TTL 为 30 秒。
- 同一时间只允许一个 quota 刷新；普通刷新遇到进行中的请求时优先返回旧缓存，没有缓存才返回“刷新进行中”的 unavailable snapshot。
- `refresh_snapshots` 等待刷新锁并强制请求，完成后覆盖缓存。
- 缓存只存在于进程内，不写磁盘。

## 6. 前端 quota 数据流

```text
启动 / Hover / 聚焦 / Tray / 定时器
                │
                ▼
        App.refresh(force)
                │
                ▼
     bridge.fetchSnapshots(force)
                │ Tauri invoke
                ▼
 get_snapshots / refresh_snapshots
                │
                ▼
 codex::fetch_snapshot
   ├─ 读取本机 auth.json
   ├─ 请求 usage + reset credits
   └─ 解析 ProviderSnapshot
                │ JSON/camelCase
                ▼
       mergeSnapshots(current, incoming)
   ├─ ok / signed_out：使用新结果
   └─ 其他失败：有旧 5 小时数据时保留旧值并标记 stale
                │
                ▼
       App 选择当前 Codex snapshot
                │
         ┌──────┴──────┐
         ▼             ▼
      QuotaOrb      QuotaCard
      折叠显示       展开显示
```

刷新节奏：

- 启动：强制刷新一次
- Hover：强制刷新并展开
- 窗口重新聚焦或从后台恢复：强制刷新
- 正常定时：5 分钟
- 5 小时窗口接近 reset：1 分钟
- 连续失败：从 30 秒指数退避，最长 30 分钟

前端用本次 5 小时剩余百分比与上次结果比较；若下降，则把“正在使用”指示灯点亮 5 分钟。这只是 UI 活跃提示，不是 Token 统计。

## 7. UI 组件结构与交互

### 7.1 组件关系

```text
main.tsx
└── App
    ├── QuotaOrb                  # compact = true
    └── QuotaCard                 # compact = false
        ├── header                # 账户/套餐、状态、常驻展开、置顶
        ├── primary metric        # 5 小时剩余百分比，缺失时回退周额度
        ├── progress              # 默认/Blur/Computer 三种进度表现
        ├── reset time            # 相对时间 + 精确时间
        └── footer
            ├── weekly metric     # 周额度、周 reset 日期
            ├── reset credits     # 数量和到期提示
            └── ProviderMark      # Codex 标识
```

### 7.2 折叠悬浮球

- 正常情况只显示整数剩余百分比和 `%`。
- 5 小时数据缺失但周额度可用时，显示周额度并加 `W` 标识。
- signed-out、stale 或 unavailable 时显示状态图标，不伪造百分比。
- 闲置 2 秒后降低视觉存在感。
- 默认可拖动，Rust 端负责边缘吸附和跨显示器边界修正。

### 7.3 Hover 展开

- 鼠标进入时先强制刷新，再调用 `expand_widget`；窗口从 80 × 80 切换到最多 314 × 314。
- 展开 command 成功后，React 从 `QuotaOrb` 切换为 `QuotaCard`。
- 鼠标离开后延迟 180 ms 收起，降低边界抖动。
- “保持展开”开启后，鼠标离开不收起。
- Hover 操作带序列号，并通过前端 promise 队列串行化窗口扩缩，避免快速进出造成展开/收起乱序。

### 7.4 视觉语言

- 展开卡片使用大号 quota 百分比、单条进度、reset 时间和底部周额度，信息层级简单。
- 状态按 healthy / caution / critical / stale / unavailable / signed-out 切换色板。
- 支持 light / dark / system，以及默认、Blur、Computer 三种皮肤表现。
- CSS 包含 reduced-motion 和高对比度适配。
- 当前展开内容被设计在固定 306 × 306 可见区域中；后续新增区域会直接影响内容密度或窗口尺寸，是 UI 集成阶段必须保留的现有约束。

## 8. Tray、置顶与自动更新

Tray 当前提供：

- 显示/隐藏
- 立即刷新
- 检查更新
- 解锁悬浮窗
- 固定/取消固定 Codex
- 中英文切换
- 跟随系统/深色/浅色主题
- 支持者皮肤
- 开机启动
- 退出

左键点击 Tray 会显示并聚焦 widget。窗口关闭仅隐藏，只有 Tray 的“退出”才终止进程。

自动更新使用 Tauri updater：

- 启动约 12 秒后前端进行静默检查，Tray 初始化后 Rust 也会后台检查并标记菜单。
- Windows 可在应用内下载、安装并重启。
- macOS 检测到更新后引导打开 GitHub Releases。
- 当前 updater endpoint、release fallback URL、Tauri capability 白名单和发布 workflow 仍指向上游 `change-42-yhmm/quota-float`。

## 9. 当前存储与隐私边界

当前主应用自行持久化的业务相关文件只有 Tauri app config 目录中的 `preferences.json` 及其备份/临时文件。内容是悬浮窗、语言、主题、皮肤和许可证设置；此外，window-state 插件会按其机制保存窗口状态。

现有 quota 能力的边界是：

- 本地读取 Codex 登录文件。
- 仅为 quota 查询把既有 access token 发送到两个 ChatGPT quota endpoint。
- 不保存 access token、account id、原始 quota 响应、prompt、聊天历史或用户代码。
- 没有 telemetry、analytics 或 crash reporting。
- 前端 CSP 的 `connect-src` 仅允许 `self`，前端不能直接向外部接口发请求。
- updater 和 quota 请求是 Rust/Tauri 原生侧允许的既有网络行为。

Token Statistics 尚不存在。后续设计需要在不改变上述 quota 链路的前提下，单独定义只读 session 解析、本地最小化存储和不保存 prompt/聊天/代码内容的边界。

## 10. 现有测试与跨平台构建基础

现有自动化覆盖：

- 前端：格式化、snapshot stale 合并、Tauri bridge 窗口切换、色板、Blur 分段等单元测试。
- Rust：quota 窗口字段兼容、比例换算、窗口识别、reset credit 到期时间、偏好设置安全、许可证和窗口几何等单元测试。
- GitHub Actions CI：
  - Ubuntu 执行 `npm test`、`npm run build`、`npm audit`。
  - Windows 执行 Rust test 和 Tauri build。
  - macOS 安装 x86_64/aarch64 targets，执行 Rust test 和 Universal Tauri build。
- tag 发布 workflow 同时生成 Windows 和 macOS Universal 制品。

本次本机验证结果：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | 未执行到测试 | 未安装 `node_modules`，找不到 `vitest` |
| `npm run build` | 未执行到编译 | 未安装 `node_modules`，找不到 `tsc` |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 未执行到测试 | 当前环境没有 `cargo` |

这些结果表示本机工具链不完整，不等同于项目测试失败。本 Step 未安装依赖，也未进行 macOS/Windows 构建。

## 11. 对 Codex Monitor 后续工作的现状结论

1. quota-float 的主链路边界清楚：`codex.rs` 负责外部 quota，`ProviderSnapshot` 是后端到前端的稳定契约，`App` 负责刷新和 UI 状态。
2. 悬浮球、Hover 展开、置顶、Tray、窗口吸附、自动更新和异常降级已经完整存在，应作为保留基线而非重写对象。
3. 当前运行时只创建 Codex snapshot；前端 `ProviderId` 中仍有未使用的 `"claude"` 类型字面量，这是遗留类型，不代表已有 Claude 功能。
4. 当前没有 Token session 读取、Token 数据模型、SQLite 或统计 command；新增能力可以与 `codex.rs` quota 获取职责分离。
5. quota 的失败不能被 Token 统计失败拖累；现有 snapshot、刷新缓存、stale 回退和 error-state 应保持独立可用。
6. 当前 306 × 306 的展开内容区域已经较紧凑。Token Usage 的四项统计要保持原视觉语言，需要在 UI 集成前明确布局和窗口尺寸策略。
7. 产品名、bundle identifier、更新源、release URL、CI 制品名和文案仍是 Quota Float；是否及何时统一改为 Codex Monitor 应在后续范围确认后处理，不属于本 Step。

## 12. Step 1 结论

quota-float 已提供 Codex Monitor 所需的桌面壳、quota 获取、悬浮交互、错误降级、本地偏好设置和 Windows/macOS 构建基础。Token Statistics 最适合以独立 Rust 模块和独立前后端数据契约接入，避免改写 `codex.rs` 的 quota 职责；但其数据来源、session 格式、去重和本地存储方案必须在 Step 2 基于真实 Codex 本机数据单独分析后确定。

本项目当前停留在 Step 1，未进入 Token Statistics 设计或编码。

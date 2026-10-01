# Repository Guidelines

## 项目结构

Codex Monitor 是基于 React 19、TypeScript 和 Tauri 2 的本地桌面监控工具。

- `src/components/` 存放界面组件，`src/hooks/` 存放 hooks，`src/lib/` 存放桥接、统计和格式化逻辑；共享类型位于 `src/types.ts`。
- `src-tauri/src/` 包含 Rust 后端；`token_stats/` 负责会话解析、聚合与 SQLite 存储。
- 前端测试与源码相邻，公共夹具位于 `src/test/`；统计后端测试位于 `src-tauri/src/token_stats/tests.rs`。
- `assets/` 存放图片和字体，`src-tauri/icons/` 存放应用图标；`scripts/`、`docs/` 分别存放检查脚本和设计、验收、发布文档。`tools/` 包含独立维护工具。

## 开发、构建与检查

准备 Node.js 22、Rust stable 及对应平台的 Tauri 2 前置依赖。在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装前端依赖 |
| `npm run dev` | 启动浏览器预览，额度使用模拟数据 |
| `npm run tauri -- dev` | 启动桌面开发应用 |
| `npm test` | 运行 Vitest 测试 |
| `npm run build` | 执行 TypeScript 检查并构建前端 |
| `npm run check:updater-policy` | 检查手动更新策略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 运行 Rust 测试 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | 检查 Rust 格式 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | 执行 Rust 静态检查，警告视为失败 |

CI 另执行 `npm audit --audit-level=high`。平台安装包命令见 `README.md`，发布流程见 `docs/RELEASE.md`。

## 编码与命名

TypeScript 启用严格模式；沿用现有两空格缩进、分号和双引号风格。组件及类型使用 PascalCase，函数和变量使用 camelCase，hooks 使用 `use` 前缀。Rust 使用 rustfmt 默认格式，模块和函数使用 snake_case。仓库未配置 ESLint 或 Prettier；不要引入无关格式化。优先复用 `src/lib/` 工具，保持补丁局部化。

## 测试要求

前端使用 Vitest；组件测试使用 React Testing Library，并通过 `// @vitest-environment jsdom` 指定环境。测试命名为 `*.test.ts` 或 `*.test.tsx`；例如 `npm test -- src/lib/quotaWeek.test.ts`。Rust 使用 `#[test]` 和临时目录夹具。

修改额度解析、快照合并或格式化时必须补充回归测试。未配置覆盖率百分比门槛；应覆盖受影响行为与边界情况。使用合成数据，禁止将自动化测试指向真实 Codex 数据目录。浏览器预览不能验证认证、原生窗口或 SQLite 集成；相关改动需记录 Windows/macOS 实机结果及未验证项。

## 提交与 Pull Request

沿用历史中的 `type: 简短说明` 格式，例如 `fix: show newest quota-week turns first`；常见前缀包括 `feat`、`fix`、`docs`、`chore`、`ci`、`release`。每次提交聚焦一个问题。

PR 应说明问题、行为变化、验证命令与结果，并关联已有 issue。界面改动附脱敏截图，平台相关改动注明系统与架构。遵守 `CONTRIBUTING.md`，保留无关的未提交改动。

## 隐私与配置

遵守 `PRIVACY.md` 和 `SECURITY.md`：不得新增遥测、凭据持久化或原始响应日志。读取路径尊重 `CODEX_HOME`；不要提交 `auth.json`、`.env`、真实会话日志、数据库或安装包。保留额度与本地 Token 统计的独立语义，不用 Token 数量推算额度。应用保持手动更新策略；发布前须完成验收并获得维护者批准。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const markerName = ".codex-monitor-acceptance";
const markerText = "codex-monitor-sidebar-acceptance-v1";
const invalidAuth = '{"tokens":{"access_token":"acceptance-invalid-token"}}';
function exists(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function validateHome(home) {
  if (!path.isAbsolute(home) || !exists(home)?.isDirectory()) throw new Error("验收目录必须是绝对路径且不能是符号链接");
  const marker = path.join(home, markerName);
  if (!exists(marker)?.isFile() || fs.readFileSync(marker, "utf8") !== markerText) throw new Error("拒绝操作未标记的目录");
  for (const name of ["sessions", "archived_sessions"]) {
    const dir = path.join(home, name);
    if (!exists(dir)?.isDirectory() || fs.readdirSync(dir).length) throw new Error("会话目录必须为空且不能是符号链接");
  }
}

export function prepareHome(home) {
  if (exists(home)) { validateHome(home); return; }
  if (!path.isAbsolute(home)) throw new Error("验收目录必须是绝对路径");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, markerName), markerText, { flag: "wx", mode: 0o600 });
  for (const name of ["sessions", "archived_sessions"]) fs.mkdirSync(path.join(home, name), { mode: 0o700 });
}

export function setAuth(home, state, source) {
  validateHome(home);
  if (!["linked", "missing", "invalid"].includes(state)) throw new Error("凭据状态应为 linked / missing / invalid");
  const target = path.join(home, "auth.json");
  if (state === "linked") {
    if (!source || !path.isAbsolute(source) || !fs.statSync(source).isFile()) throw new Error("真实凭据来源必须是现有文件的绝对路径");
    const resolved = fs.realpathSync(source);
    const relative = path.relative(fs.realpathSync(home), resolved);
    if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("凭据来源不能位于验收目录");
  }
  const current = exists(target);
  if (current) {
    // 仅解除链接，绝不沿链接打开真实凭据进行写入。
    if (!current.isSymbolicLink() && (!current.isFile() || fs.readFileSync(target, "utf8") !== invalidAuth)) {
      throw new Error("拒绝覆盖非本脚本创建的凭据文件");
    }
    fs.unlinkSync(target);
  }
  if (state === "linked") fs.symlinkSync(source, target, "file");
  if (state === "invalid") fs.writeFileSync(target, invalidAuth, { flag: "wx", mode: 0o600 });
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--") || !rest[i + 1]) throw new Error("参数使用 --名称 值");
    options[rest[i].slice(2)] = rest[i + 1];
  }
  const mode = options.mode || "live";
  if (!["live", "synthetic"].includes(mode)) throw new Error("mode 应为 live / synthetic");
  const base = process.platform === "win32" ? (process.env.LOCALAPPDATA || os.tmpdir()) : "/private/tmp";
  const home = options.home || path.join(base, `codex-monitor-${mode}-acceptance-home`);
  if (action === "prepare") prepareHome(home);
  else if (action === "auth") {
    if (mode !== "live") throw new Error("合成实例不读取真实凭据");
    const source = options.source || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json");
    setAuth(home, options.state, source);
  } else if (action === "start") {
    validateHome(home);
    if (!options.app || !path.isAbsolute(options.app) || !fs.statSync(options.app).isFile()) throw new Error("--app 必须是验收二进制的绝对路径");
    const env = { ...process.env, CODEX_HOME: home };
    for (const key of Object.keys(env)) if (key.startsWith("CODEX_MONITOR_SYNTHETIC_")) delete env[key];
    if (mode === "synthetic") Object.assign(env, { CODEX_MONITOR_SYNTHETIC_QUOTA: "1", CODEX_MONITOR_SYNTHETIC_SHORT_WINDOW: "1", CODEX_MONITOR_SYNTHETIC_PRO: "1" });
    const child = spawn(options.app, [], { env, stdio: "inherit" });
    child.on("error", () => { console.error("验收应用启动失败"); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    return;
  } else throw new Error("命令：prepare | auth --state linked/missing/invalid | start --app 绝对路径");
  console.log(`已完成 ${action}；隔离目录：${home}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

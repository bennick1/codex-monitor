import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { prepareHome, setAuth, validateHome } from "./run.mjs";

test("切换失效夹具不修改凭据来源", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-auth-check-"));
  try {
    const source = path.join(root, "source.json");
    const content = '{"tokens":{"access_token":"fixture-only"}}';
    fs.writeFileSync(source, content);
    const home = path.join(root, "home");
    prepareHome(home);
    setAuth(home, "linked", source);
    assert.equal(fs.lstatSync(path.join(home, "auth.json")).isSymbolicLink(), true);
    setAuth(home, "invalid");
    assert.equal(fs.lstatSync(path.join(home, "auth.json")).isSymbolicLink(), false);
    setAuth(home, "missing");
    assert.equal(fs.existsSync(path.join(home, "auth.json")), false);
    setAuth(home, "linked", source);
    assert.equal(fs.readFileSync(source, "utf8"), content);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("拒绝未标记目录、真实会话和未知凭据文件", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-boundary-check-"));
  try {
    assert.throws(() => prepareHome(root));
    const home = path.join(root, "home");
    prepareHome(home);
    fs.writeFileSync(path.join(home, "auth.json"), "unknown");
    assert.throws(() => setAuth(home, "missing"));
    fs.writeFileSync(path.join(home, "sessions", "fixture.jsonl"), "fixture");
    assert.throws(() => validateHome(home));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

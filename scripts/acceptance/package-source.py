"""打包 Git 工作区中的验收源码，不包含构建产物和用户数据。"""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

repo = Path(__file__).resolve().parents[2]
allowed_roots = {"src", "src-tauri", "assets", "scripts", "docs"}
allowed_top = {"AGENTS.md", "README.md", "CONTRIBUTING.md", "PRIVACY.md", "SECURITY.md", "LICENSE", "LICENSE.md", "package.json", "package-lock.json", "index.html", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", ".gitignore"}
denied_parts = {"target", "node_modules", "outputs", ".git", ".env", "auth.json", "sessions", "archived_sessions"}
denied_suffixes = {".db", ".sqlite", ".sqlite3", ".log", ".jsonl", ".zip", ".dmg", ".exe", ".pfx", ".pem", ".key"}
names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=repo).decode().split("\0")
files = []
for name in sorted(set(filter(None, names))):
    relative = Path(name)
    if relative.parts[0] not in allowed_roots and name not in allowed_top:
        continue
    source = repo / relative
    if any(part in denied_parts or part.startswith(".env.") for part in relative.parts) or relative.suffix in denied_suffixes:
        continue
    if source.is_symlink():
        raise SystemExit(f"拒绝打包符号链接：{name}")
    if source.is_file():
        files.append({"path": name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
for required in ["package-lock.json", "src-tauri/Cargo.lock", "scripts/acceptance/live.json", "scripts/acceptance/build-windows.ps1"]:
    if required not in {item["path"] for item in files}:
        raise SystemExit(f"缺少源码：{required}")
manifest = {
    "branch": subprocess.check_output(["git", "branch", "--show-current"], cwd=repo).decode().strip(),
    "baseCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo).decode().strip(),
    "includesUncommittedChanges": True,
    "files": files,
}
raw = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
out = repo / "outputs/sidebar-acceptance" / stamp
out.mkdir(parents=True)
archive = out / "codex-monitor-sidebar-source.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for item in files:
        bundle.write(repo / item["path"], item["path"])
    bundle.writestr("SOURCE-MANIFEST.json", raw)
(out / "SOURCE-MANIFEST.json").write_bytes(raw)
checksums = "".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in [archive, out / "SOURCE-MANIFEST.json"])
(out / "SHA256SUMS.txt").write_text(checksums)
print(f"源码文件：{len(files)}；交付目录：{out}\n{checksums}")

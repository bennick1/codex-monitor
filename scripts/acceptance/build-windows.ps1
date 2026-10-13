param([switch]$Build)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $repo
$missing = [System.Collections.Generic.List[string]]::new()
$osInfo = Get-CimInstance Win32_OperatingSystem
if ($osInfo.Caption -notmatch "Windows 11" -or $env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    $missing.Add("需要 Windows 11 x64 原生 PowerShell")
}
foreach ($tool in @("node", "npm.cmd", "cargo", "rustc", "rustup")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing.Add("缺少 $tool") }
}
if (Get-Command node -ErrorAction SilentlyContinue) {
    if ((& node --version) -notmatch '^v22\.') { $missing.Add("需要 Node.js 22；请在本终端自行选择版本") }
}
if (Get-Command rustup -ErrorAction SilentlyContinue) {
    if ((& rustup target list --installed) -notcontains "x86_64-pc-windows-msvc") { $missing.Add("缺少 Rust x86_64-pc-windows-msvc 目标") }
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
$vsPath = ""
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
if (-not $vsPath) { $missing.Add("缺少 Visual Studio MSVC x64 C++ Build Tools") }
$sdk = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots" -ErrorAction SilentlyContinue
if (-not $sdk -or -not ($sdk.PSObject.Properties.Name -contains "KitsRoot10") -or
    -not (Test-Path (Join-Path $sdk.KitsRoot10 "Include/*/um/Windows.h"))) { $missing.Add("缺少 Windows 10/11 SDK") }
$webViewVersion = $null
$webViewId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
foreach ($root in @("HKLM:\SOFTWARE\WOW6432Node", "HKLM:\SOFTWARE", "HKCU:\SOFTWARE")) {
    $key = Get-ItemProperty "$root\Microsoft\EdgeUpdate\Clients\$webViewId" -ErrorAction SilentlyContinue
    if ($key -and ($key.PSObject.Properties.Name -contains "pv") -and $key.pv -ne "0.0.0.0") { $webViewVersion = $key.pv }
}
if (-not $webViewVersion) { $missing.Add("未检测到 WebView2 Runtime；需在设备上确认或安装") }
if ($missing.Count) { $missing | ForEach-Object { Write-Host "[缺项] $_" }; exit 1 }
Write-Host "前置检查通过；未安装或修改全局工具链。"
if (-not $Build) { Write-Host "构建时添加 -Build 参数。"; exit 0 }

$manifestPath = Join-Path $repo "SOURCE-MANIFEST.json"
if (-not (Test-Path $manifestPath)) { throw "请在交付的源码快照内构建，缺少 SOURCE-MANIFEST.json" }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $actual = (Get-FileHash (Join-Path $repo $entry.path) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { throw "源码校验失败：$($entry.path)" }
}
$out = Join-Path $repo ("outputs/windows-acceptance/" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$environment = [ordered]@{
    os = $osInfo.Caption; build = $osInfo.BuildNumber; architecture = $env:PROCESSOR_ARCHITECTURE
    node = (& node --version); npm = (& npm.cmd --version); rust = (& rustc --version)
    cargo = (& cargo --version); visualStudio = $vsPath
    msvc = (Get-Content (Join-Path $vsPath "VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt") -Raw).Trim()
    windowsSdk = @(Get-ChildItem (Join-Path $sdk.KitsRoot10 "Include") -Directory | Where-Object { Test-Path (Join-Path $_.FullName "um/Windows.h") } | Select-Object -ExpandProperty Name)
    webview2 = $webViewVersion
    sourceManifestSha256 = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    timestamp = (Get-Date).ToString("o")
}
$environment | ConvertTo-Json | Set-Content (Join-Path $out "environment.json") -Encoding UTF8
function Invoke-Checked([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program 失败，退出码 $LASTEXITCODE" }
}
$oldCache = $env:npm_config_cache
try {
    $env:npm_config_cache = Join-Path $repo "outputs/npm-cache"
    Invoke-Checked "npm.cmd" @("ci")
    Invoke-Checked "node" @("--test", "scripts/acceptance/run.check.mjs")
    Invoke-Checked "npm.cmd" @("test")
    Invoke-Checked "npm.cmd" @("run", "check:updater-policy")
    Invoke-Checked "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--target", "x86_64-pc-windows-msvc")
    foreach ($mode in @("synthetic", "live")) {
        # 两种包分开构建、复制，避免后一次编译覆盖前一次二进制。
        Invoke-Checked "npm.cmd" @("run", "tauri", "--", "build", "--debug", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis", "--config", "scripts/acceptance/$mode.json", "--", "--locked")
        $dest = Join-Path $out $mode
        New-Item -ItemType Directory -Path $dest | Out-Null
        Copy-Item "src-tauri/target/x86_64-pc-windows-msvc/debug/codex-monitor.exe" $dest
        $name = if ($mode -eq "live") { "Codex Monitor Sidebar Acceptance" } else { "Codex Monitor Sidebar Test" }
        $installers = @(Get-ChildItem "src-tauri/target/x86_64-pc-windows-msvc/debug/bundle/nsis" -Filter "${name}_*_x64-setup.exe")
        if ($installers.Count -ne 1) { throw "NSIS 安装包数量异常；请核对构建输出" }
        Copy-Item $installers[0].FullName $dest
    }
    Get-ChildItem $out -Recurse -File | Where-Object Name -ne "SHA256SUMS.txt" | ForEach-Object {
        "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($out.Length + 1)
    } | Set-Content (Join-Path $out "SHA256SUMS.txt") -Encoding UTF8
    Write-Host "构建完成：$out；Windows 安装和交互仍须按验收文档实测。"
} finally { $env:npm_config_cache = $oldCache }

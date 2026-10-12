#requires -Version 7.0
param([string]$OutputDirectory = (Join-Path $PSScriptRoot "outputs"))

# 只读诊断；仅在输出目录写报告，不安装工具或修改服务、防火墙。
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw "请在 Windows 的 PowerShell 7 中执行。" }
$notes = [System.Collections.Generic.List[string]]::new()
$missing = [System.Collections.Generic.List[string]]::new()
$os = Get-CimInstance Win32_OperatingSystem
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$report = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    machine = $env:COMPUTERNAME
    loginName = $env:USERNAME
    account = $identity.Name
    administrator = $admin
    powershell = $PSVersionTable.PSVersion.ToString()
    os = $os.Caption
    osBuild = $os.BuildNumber
    architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
}

function Get-ToolVersion([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { return $null }
    try {
        $text = (& $command.Source --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "退出码 $LASTEXITCODE" }
        return [ordered]@{ path = $command.Source; version = $text }
    } catch { $notes.Add("读取 $Name 版本失败：$($_.Exception.Message)"); return $null }
}

# 只保留本机 Tailscale 信息，不输出其他设备或账户资料。
$tailscale = Get-Command tailscale.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$tailscalePath = if ($tailscale) { $tailscale.Source } else { Join-Path $env:ProgramFiles "Tailscale/tailscale.exe" }
$tailnet = $null
if (Test-Path $tailscalePath) {
    try {
        $raw = & $tailscalePath status --json
        if ($LASTEXITCODE -ne 0) { throw "退出码 $LASTEXITCODE" }
        $state = $raw | ConvertFrom-Json
        $tailnet = [ordered]@{
            state = $state.BackendState
            hostName = $state.Self.HostName
            addresses = @($state.Self.TailscaleIPs)
        }
    } catch { $notes.Add("读取 Tailscale 状态失败：$($_.Exception.Message)") }
} else { $notes.Add("未找到 Tailscale 命令。") }
$report.tailscale = $tailnet

$sshd = Get-Service sshd -ErrorAction SilentlyContinue
$ports = @(22)
$sshConfig = Join-Path $env:ProgramData "ssh/sshd_config"
if (Test-Path $sshConfig) {
    try {
        $configuredPorts = @(Get-Content $sshConfig | ForEach-Object {
            if ($_ -match '^\s*Port\s+(\d+)\s*(?:#.*)?$') { [int]$Matches[1] }
        })
        if ($configuredPorts.Count) { $ports = @($configuredPorts | Select-Object -Unique) }
    } catch { $notes.Add("无法读取 SSH 端口配置：$($_.Exception.Message)") }
}
$listeners = @()
try {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -in $ports } |
        Select-Object LocalAddress, LocalPort, OwningProcess)
} catch { $notes.Add("无法读取监听端口：$($_.Exception.Message)") }
$rules = @()
try {
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction Stop |
        Where-Object { $_.Direction -eq "Inbound" -and ($_.Name -match 'ssh|tailscale' -or $_.DisplayName -match 'ssh|tailscale') } |
        ForEach-Object {
            $portFilter = $_ | Get-NetFirewallPortFilter
            $addressFilter = $_ | Get-NetFirewallAddressFilter
            [pscustomobject]@{
                name = $_.Name; enabled = $_.Enabled.ToString(); action = $_.Action.ToString()
                profile = $_.Profile.ToString(); protocol = $portFilter.Protocol
                localPort = @($portFilter.LocalPort); remoteAddress = @($addressFilter.RemoteAddress)
            }
        })
} catch { $notes.Add("无法读取防火墙规则：$($_.Exception.Message)；可用管理员终端重新检查。") }
$report.ssh = [ordered]@{
    installed = [bool]$sshd
    serviceState = if ($sshd) { $sshd.Status.ToString() } else { "未检测到 sshd 服务" }
    configuredPorts = $ports
    listeners = $listeners
    namedFirewallRules = $rules
}
if (-not $sshd) { $notes.Add("未检测到 OpenSSH Server 服务；Tailscale 在线不代表 SSH 已启用。") }
elseif ($sshd.Status -ne "Running") { $notes.Add("sshd 服务未运行。") }
if (-not $listeners.Count) { $notes.Add("配置的 SSH 端口没有监听；本机结果也不能代替 Mac 到 Windows 的连通测试。") }

$toolVersions = [ordered]@{}
foreach ($name in @("node.exe", "npm.cmd", "cargo.exe", "rustc.exe", "rustup.exe")) {
    $version = Get-ToolVersion $name
    $toolVersions[$name] = $version
    if (-not $version) { $missing.Add("缺少或无法执行 $name") }
}
if ($toolVersions["node.exe"] -and $toolVersions["node.exe"].version -notmatch '^v22\.') {
    $missing.Add("当前 Node.js 不是 22；构建前需要在构建终端选择 Node.js 22。")
}
$targets = @()
if ($toolVersions["rustup.exe"]) {
    try {
        $targets = @(& $toolVersions["rustup.exe"].path target list --installed)
        if ($LASTEXITCODE -ne 0) { throw "退出码 $LASTEXITCODE" }
    } catch { $notes.Add("读取 Rust 目标失败：$($_.Exception.Message)") }
}
if ($targets -notcontains "x86_64-pc-windows-msvc") { $missing.Add("缺少 Rust x86_64-pc-windows-msvc 目标。") }
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
$vsPath = ""
if (Test-Path $vswhere) {
    $vsPath = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Out-String).Trim()
}
if (-not $vsPath) { $missing.Add("未检测到 MSVC x64 C++ Build Tools。") }
$sdk = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots" -ErrorAction SilentlyContinue
$sdkVersions = @()
if ($sdk -and $sdk.PSObject.Properties.Name -contains "KitsRoot10") {
    $sdkVersions = @(Get-ChildItem (Join-Path $sdk.KitsRoot10 "Include") -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "um/Windows.h") } | Select-Object -ExpandProperty Name)
}
if (-not $sdkVersions.Count) { $missing.Add("未检测到 Windows SDK。") }
$webViewVersion = $null
foreach ($root in @("HKLM:\SOFTWARE\WOW6432Node", "HKLM:\SOFTWARE", "HKCU:\SOFTWARE")) {
    $key = Get-ItemProperty "$root\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if ($key -and $key.PSObject.Properties.Name -contains "pv" -and $key.pv -ne "0.0.0.0") { $webViewVersion = $key.pv }
}
if (-not $webViewVersion) { $missing.Add("注册表未检测到 WebView2 Runtime；需要在设备上核实。") }
if ($os.Caption -notmatch "Windows 11" -or $report.architecture -ne "X64") { $missing.Add("验收目标需要 Windows 11 x64。") }
$report.build = [ordered]@{
    tools = $toolVersions; rustTargets = $targets; visualStudio = $vsPath
    windowsSdk = $sdkVersions; webview2 = $webViewVersion; missing = @($missing)
}
$report.notes = @($notes)

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$path = Join-Path $OutputDirectory ("windows-build-check-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding utf8
Write-Host "只读检查完成，未修改系统。登录用户名：$($report.loginName)；管理员：$admin"
Write-Host "SSH：$($report.ssh.serviceState)；配置端口：$($ports -join ', ')；监听数：$($listeners.Count)"
if ($tailnet) { Write-Host "Tailscale：$($tailnet.state)；本机地址：$($tailnet.addresses -join ', ')" }
foreach ($item in $missing) { Write-Host "[构建缺项] $item" }
foreach ($item in $notes) { Write-Host "[检查说明] $item" }
Write-Host "报告：$path"
Write-Host "请回传本报告；其中不包含密码、私钥或网站登录数据。"

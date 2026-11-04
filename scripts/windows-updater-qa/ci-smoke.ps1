#requires -Version 5.1
param([Parameter(Mandatory = $true)][string]$PackageDirectory)
# Runner-only helper validation. Deliberately never installs or launches A/B.
$ErrorActionPreference = 'Stop'
$kit = (Resolve-Path -LiteralPath $PackageDirectory).Path
. (Join-Path $kit 'scripts/common.ps1')
Assert-QaPackage
foreach ($target in @($QaRuntime, $QaConfig, $QaData)) {
    if (Test-Path -LiteralPath $target) { throw 'CI smoke requires fresh isolated QA paths.' }
}
New-Item -ItemType Directory -Path $QaRuntime, $QaData | Out-Null
New-Item -ItemType Directory -Path $QaHome, $QaEvidence | Out-Null
Write-QaJson $QaMarker @{ sourceSha = $QaSource.sourceSha; runtime = $QaRuntime; packageRoot = $PackageRoot; createdAt = (Get-Date).ToString('o') }
Assert-QaSession
New-Item -ItemType File -Path (Join-Path $QaHome 'synthetic-nonempty-marker') | Out-Null
$rejected = $false
try { Assert-QaSession } catch { $rejected = $true }
if (-not $rejected) { throw 'Nonempty CODEX_HOME was accepted.' }
Remove-Item -LiteralPath (Join-Path $QaHome 'synthetic-nonempty-marker')
New-Item -ItemType File -Path $QaDatabase | Out-Null
Initialize-QaSqlite
$schemaRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'src-tauri/src/token_stats'
foreach ($name in @('schema.sql', 'model_schema.sql', 'turn_schema.sql', 'fast_schema.sql')) {
    [CmWindowsQaSqlite]::Execute($QaDatabase, (Get-Content -LiteralPath (Join-Path $schemaRoot $name) -Raw))
}
Assert-QaDatabase
$rejected = $false
try { Add-QaSyntheticStats } catch { $rejected = $true }
if (-not $rejected) { throw 'Seeding without an initialized source root was accepted.' }
$fakeRoot = 'a' * 64
[CmWindowsQaSqlite]::Execute($QaDatabase, "INSERT INTO source_roots(root,state) VALUES('$fakeRoot','{}');")
Add-QaSyntheticStats
$facts = [CmWindowsQaSqlite]::Query($QaDatabase, 'SELECT input+output,time_status FROM token_facts')
if ($facts.Length -ne 1 -or $facts[0][0] -ne '13023' -or $facts[0][1] -ne 'dated') { throw 'Synthetic fixture mismatch.' }
$rejected = $false
try { Add-QaSyntheticStats } catch { $rejected = $true }
if (-not $rejected) { throw 'Duplicate seeding was accepted.' }
$integrity = [CmWindowsQaSqlite]::Query($QaDatabase, 'PRAGMA integrity_check')
if ($integrity[0][0] -ne 'ok') { throw 'Synthetic database failed integrity check.' }
Write-Host 'PASS: actual Windows SQLite interop, empty-home guard, schema, root guard, 13,023 sample, duplicate refusal and integrity.'

$server = $null
$serverExitStatus = @{ phase = 'starting'; pid = $null; handleRetained = $false; waitCompleted = $null; exitCode = $null }
try {
    $serverScript = Join-Path $kit 'scripts/server.ps1'
    $server = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $serverScript + '"')) -RedirectStandardOutput (Join-Path $QaEvidence 'server-out.txt') -RedirectStandardError (Join-Path $QaEvidence 'server-error.txt') -PassThru
    # Windows PowerShell 5.1 must retain this handle before a redirected child
    # exits, otherwise Start-Process can leave ExitCode null (PowerShell #5421).
    $serverHandle = $server.Handle
    $serverExitStatus.pid = $server.Id
    $serverExitStatus.handleRetained = $serverHandle -ne [IntPtr]::Zero
    if (-not $serverExitStatus.handleRetained) { throw 'Could not retain QA server process handle.' }
    $serverExitStatus.phase = 'readiness'
    $ready = $false
    for ($i = 0; $i -lt 50; $i++) {
        if ($server.HasExited) { throw 'QA server exited before readiness.' }
        try {
            $response = Invoke-WebRequest 'http://127.0.0.1:18765/latest.json' -UseBasicParsing -TimeoutSec 1
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'QA server did not become ready.' }
    $serverExitStatus.phase = 'requests'
    $manifest = $response.Content | ConvertFrom-Json
    if ($manifest.version -ne '0.0.2' -or $manifest.platforms.'windows-x86_64'.url -ne 'http://127.0.0.1:18765/B-0.0.2-setup.exe') { throw 'Wrong QA manifest.' }
    $listeners = @(Get-NetTCPConnection -LocalPort 18765 -State Listen)
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $server.Id) { throw 'QA server was not exclusively loopback-bound.' }
    $requests = @(Get-Content -LiteralPath (Join-Path $QaEvidence 'requests.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
    if (@($requests | Where-Object { $_.route -ne '/latest.json' }).Count) { throw 'Manifest check unexpectedly fetched a payload.' }
    $download = Join-Path $QaRuntime 'downloaded-B.exe'
    Invoke-WebRequest $manifest.platforms.'windows-x86_64'.url -UseBasicParsing -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $QaSource.versions[1].installerSha256) { throw 'Loopback download bytes differ from signed B.' }
    $status = 0
    try { Invoke-WebRequest 'http://127.0.0.1:18765/test.key' -UseBasicParsing | Out-Null } catch { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -ne 404) { throw 'Server exposed a non-allowlisted path.' }
    [IO.File]::WriteAllText((Join-Path $QaRuntime 'stop-server'), 'CI smoke complete')
    $serverExitStatus.phase = 'shutdown'
    $serverExitStatus.waitCompleted = $server.WaitForExit(10000)
    if ($serverExitStatus.waitCompleted) {
        $server.WaitForExit()
        $serverExitStatus.exitCode = $server.ExitCode
    }
    if (-not $serverExitStatus.waitCompleted -or $null -eq $serverExitStatus.exitCode -or $serverExitStatus.exitCode -ne 0) { throw 'QA server did not stop cleanly; see server-exit-status.json.' }
    if (@(Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue).Count) { throw 'QA port remained open after stop.' }
    $serverExitStatus.phase = 'passed'
    Write-Host 'PASS: packaged loopback server, manifest-only request, exact B download, private-path 404 and shutdown.'
    Write-Host 'No application installation, UI or native upgrade was tested; human Windows acceptance remains PENDING.'
} catch {
    Write-Host ('QA server exit status: ' + ($serverExitStatus | ConvertTo-Json -Compress))
    foreach ($name in @('server-out.txt', 'server-error.txt')) {
        $log = Join-Path $QaEvidence $name
        if (Test-Path -LiteralPath $log -PathType Leaf) {
            Write-Host ("Controlled QA server log: $name")
            Get-Content -LiteralPath $log -Tail 80 | ForEach-Object { Write-Host $_ }
        }
    }
    throw
} finally {
    Write-QaJson (Join-Path $QaEvidence 'server-exit-status.json') $serverExitStatus
    if ($server -and -not $server.HasExited) {
        [IO.File]::WriteAllText((Join-Path $QaRuntime 'stop-server'), 'CI cleanup')
        if (-not $server.WaitForExit(10000)) { Stop-Process -Id $server.Id -Force }
    }
}

#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell on Windows x64.' }
$PackageRoot = Split-Path -Parent $PSScriptRoot
$QaRuntime = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexMonitorUpdaterQA-CM-RELEASE-ENABLEMENT-20261103'
$QaInstall = Join-Path $QaRuntime 'installed'
$QaExe = Join-Path $QaInstall 'codex-monitor.exe'
$QaHome = Join-Path $QaRuntime 'empty-codex-home'
$QaConfig = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'app.codexmonitor.updater-test.local'
$QaData = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'app.codexmonitor.updater-test.local'
$QaDatabase = Join-Path $QaData 'token-statistics.sqlite3'
$QaMarker = Join-Path $QaRuntime 'qa-session.json'
$QaEvidence = Join-Path $QaRuntime 'evidence'
$QaSeedId = 'cm-release-enablement-windows-synthetic-20261103'
$QaSource = Get-Content -LiteralPath (Join-Path $PackageRoot 'QA-SOURCE.json') -Raw | ConvertFrom-Json

function Write-QaJson([string]$File, $Value) {
    $Value | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $File -Encoding UTF8
}

function Assert-NoReparse([string]$File) {
    $cursor = [IO.Path]::GetFullPath($File)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing reparse point: $cursor" }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-QaPackage {
    if ($QaSource.schema -ne 1 -or $QaSource.qa -ne $true -or $QaSource.releaseBuild -ne $false -or $QaSource.sourceSha -notmatch '^[a-f0-9]{40}$' -or $QaSource.identifier -ne 'app.codexmonitor.updater-test.local' -or $QaSource.productName -ne 'Codex Monitor Updater QA' -or $QaSource.endpoint -ne 'http://127.0.0.1:18765/latest.json') { throw 'Not a verified isolated QA package.' }
    foreach ($entry in Get-Content -LiteralPath (Join-Path $PackageRoot 'SHA256SUMS')) {
        if ($entry -notmatch '^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$') { throw 'Invalid checksum entry.' }
        $expected = $Matches[1]
        $relative = $Matches[2]
        if ($relative.StartsWith('/') -or $relative.Split('/') -contains '..') { throw 'Unsafe checksum path.' }
        $file = Join-Path $PackageRoot $relative
        Assert-NoReparse $file
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "Changed package file: $relative" }
    }
    foreach ($target in @($QaRuntime, $QaInstall, $QaHome, $QaConfig, $QaData, $QaDatabase)) { Assert-NoReparse $target }
}

function Assert-QaSession {
    Assert-QaPackage
    if (-not (Test-Path -LiteralPath $QaMarker -PathType Leaf)) { throw 'Install this package with 01-Install-A.cmd first.' }
    $session = Get-Content -LiteralPath $QaMarker -Raw | ConvertFrom-Json
    if ($session.sourceSha -ne $QaSource.sourceSha -or $session.runtime -ne $QaRuntime -or $session.packageRoot -ne $PackageRoot) { throw 'Different QA session/package detected. Preserve it and ask the maintainer.' }
    if (-not (Test-Path -LiteralPath $QaHome -PathType Container) -or @(Get-ChildItem -LiteralPath $QaHome -Force).Count) { throw 'QA CODEX_HOME must remain an empty dedicated directory.' }
}

function Get-QaProcesses {
    $found = @(Get-CimInstance Win32_Process -Filter "Name = 'codex-monitor.exe'")
    foreach ($item in $found) {
        if (-not $item.ExecutablePath) { throw 'Cannot inspect a codex-monitor.exe process. Stop and ask the maintainer; do not kill an unknown process.' }
        if ($item.ExecutablePath -eq $QaExe) { [pscustomobject]@{ pid = $item.ProcessId; executable = $item.ExecutablePath; createdAt = $item.CreationDate.ToString('o') } }
    }
}

function Assert-QaStopped {
    if (@(Get-QaProcesses).Count) { throw 'Exit the QA application from its system tray first. Do not kill or alter the production application.' }
}

function Get-QaBinary {
    Assert-NoReparse $QaExe
    $file = Get-Item -LiteralPath $QaExe
    $v = $file.VersionInfo
    $version = '{0}.{1}.{2}' -f $v.FileMajorPart, $v.FileMinorPart, $v.FileBuildPart
    $expected = @($QaSource.versions | Where-Object { $_.version -eq $version })
    $actual = (Get-FileHash -LiteralPath $QaExe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($v.ProductName -ne 'Codex Monitor Updater QA' -or $expected.Count -ne 1 -or $actual -ne $expected[0].binarySha256) { throw 'Installed executable is not an exact A/B binary from this QA package.' }
    [pscustomobject]@{ version = $version; binarySha256 = $actual; executable = $QaExe; productName = $v.ProductName }
}

function Start-QaApplication {
    Assert-QaSession
    Assert-QaStopped
    $binary = Get-QaBinary
    $env:CODEX_HOME = $QaHome
    $env:CODEX_MONITOR_SYNTHETIC_QUOTA = '1'
    $process = Start-Process -FilePath $QaExe -WorkingDirectory $QaInstall -PassThru
    Write-QaJson (Join-Path $QaEvidence ('launch-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')) @{ timestamp = (Get-Date).ToString('o'); pid = $process.Id; binary = $binary; sourceSha = $QaSource.sourceSha }
    Write-Host "Started isolated QA $($binary.version), PID $($process.Id)."
    Write-Host 'For cold start, completely exit from the QA tray, then use 02-Start-QA.cmd again.'
}

function Initialize-QaSqlite {
    if ('CmWindowsQaSqlite' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CmWindowsQaSqlite {
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int count, out IntPtr stmt, IntPtr tail);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr stmt);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr stmt);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_count(IntPtr stmt);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr stmt, int col);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr callback, IntPtr arg, IntPtr error);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_busy_timeout(IntPtr db, int milliseconds);
    static byte[] Utf8(string value) { return Encoding.UTF8.GetBytes(value + "\0"); }
    static IntPtr Open(string file, bool write) {
        IntPtr db;
        int rc = sqlite3_open_v2(Utf8(file), out db, write ? 2 : 1, IntPtr.Zero);
        if (rc != 0) { if (db != IntPtr.Zero) sqlite3_close(db); throw new Exception("QA SQLite open failed: " + rc); }
        sqlite3_busy_timeout(db, 1000);
        return db;
    }
    public static string[][] Query(string file, string sql) {
        IntPtr db = Open(file, false); IntPtr stmt = IntPtr.Zero;
        try {
            int rc = sqlite3_prepare_v2(db, Utf8(sql), -1, out stmt, IntPtr.Zero);
            if (rc != 0) throw new Exception("QA SQLite prepare failed: " + rc);
            var rows = new List<string[]>();
            while ((rc = sqlite3_step(stmt)) == 100) {
                var row = new string[sqlite3_column_count(stmt)];
                for (int col = 0; col < row.Length; col++) {
                    IntPtr ptr = sqlite3_column_text(stmt, col); int length = sqlite3_column_bytes(stmt, col);
                    if (ptr == IntPtr.Zero) { row[col] = null; continue; }
                    byte[] bytes = new byte[length]; Marshal.Copy(ptr, bytes, 0, length); row[col] = Encoding.UTF8.GetString(bytes);
                }
                rows.Add(row);
            }
            if (rc != 101) throw new Exception("QA SQLite read failed: " + rc);
            return rows.ToArray();
        } finally { if (stmt != IntPtr.Zero) sqlite3_finalize(stmt); sqlite3_close(db); }
    }
    public static void Execute(string file, string sql) {
        IntPtr db = Open(file, true);
        try { int rc = sqlite3_exec(db, Utf8(sql), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); if (rc != 0) throw new Exception("QA SQLite write failed: " + rc); }
        finally { sqlite3_close(db); }
    }
}
'@
}

function Assert-QaDatabase {
    Assert-QaSession
    Assert-NoReparse $QaDatabase
    if (-not (Test-Path -LiteralPath $QaDatabase -PathType Leaf)) { throw 'Open A once and completely exit it before seeding stats.' }
    Initialize-QaSqlite
    $app = [CmWindowsQaSqlite]::Query($QaDatabase, 'PRAGMA application_id')
    $schema = [CmWindowsQaSqlite]::Query($QaDatabase, 'PRAGMA user_version')
    if ($app[0][0] -ne '1129598795' -or $schema[0][0] -ne '4') { throw 'Unexpected QA statistics database identity/schema.' }
}

function Add-QaSyntheticStats {
    Assert-QaStopped
    Assert-QaDatabase
    $seedMarker = Join-Path $QaRuntime 'synthetic-seed.json'
    if (Test-Path -LiteralPath $seedMarker) { throw 'Sample already seeded. Use 02-Start-QA.cmd; do not overwrite QA data.' }
    $roots = [CmWindowsQaSqlite]::Query($QaDatabase, 'SELECT root FROM source_roots')
    if ($roots.Length -ne 1 -or $roots[0][0] -notmatch '^[a-f0-9]{64}$') { throw 'Expected one initialized, isolated source root. Open A once, exit it, then retry.' }
    $existing = [CmWindowsQaSqlite]::Query($QaDatabase, 'SELECT count(*) FROM token_facts')
    if ($existing[0][0] -ne '0') { throw 'QA already contains statistics. Preserve them and ask the maintainer instead of replacing them.' }
    $at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    [CmWindowsQaSqlite]::Execute($QaDatabase, "BEGIN IMMEDIATE; INSERT INTO token_facts(id,root,thread,input,output,cached,reasoning,cache_write,at,end_at,time_status,format,active,rule_version) SELECT '$QaSeedId',root,'synthetic-windows-qa-thread',12345,678,1000,100,0,'$at','$at','dated','response',1,1 FROM source_roots; UPDATE statistics_meta SET generation=generation+1 WHERE singleton=1; COMMIT;")
    Write-QaJson $seedMarker @{ id = $QaSeedId; input = 12345; output = 678; total = 13023; timestamp = $at; sourceSha = $QaSource.sourceSha }
}

function Save-QaSnapshot([string]$Label) {
    Assert-QaSession
    if ($Label -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$') { throw 'Use a short ASCII label, for example A-before-check or B-cold-start.' }
    $destination = Join-Path $QaEvidence ($Label + '.json')
    if (Test-Path -LiteralPath $destination) { throw 'Snapshot already exists; choose a new label.' }
    Assert-QaDatabase
    $binary = Get-QaBinary
    $preferences = Join-Path $QaConfig 'preferences.json'
    Assert-NoReparse $preferences
    $settings = Get-Content -LiteralPath $preferences -Raw | ConvertFrom-Json
    $facts = [CmWindowsQaSqlite]::Query($QaDatabase, "SELECT id,input,output,cached,reasoning,active,time_status FROM token_facts WHERE id='$QaSeedId'")
    $integrity = [CmWindowsQaSqlite]::Query($QaDatabase, 'PRAGMA integrity_check')
    $os = Get-CimInstance Win32_OperatingSystem
    $requests = Join-Path $QaEvidence 'requests.jsonl'
    $requestLines = if (Test-Path -LiteralPath $requests) { @(Get-Content -LiteralPath $requests) } else { @() }
    Write-QaJson $destination @{ timestamp = (Get-Date).ToString('o'); sourceSha = $QaSource.sourceSha; os = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture }; powershell = $PSVersionTable.PSVersion.ToString(); binary = $binary; processes = @(Get-QaProcesses); settings = $settings; syntheticFacts = $facts; databaseIntegrity = $integrity; emptyCodexHome = $true; requests = $requestLines }
    Write-Host "Saved: $destination"
    Write-Host 'This records observations, not a PASS. Add the actual UI actions and result to the checklist.'
}

#requires -Version 5.1
param([string]$EvidenceDirectory = 'outputs/windows-updater-qa/process-smoke')
# CI-only regression for redirected Start-Process in Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This regression requires Windows.' }
$root = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $root) { throw 'Process smoke evidence directory already exists.' }
New-Item -ItemType Directory -Path $root | Out-Null
$report = @{ powershellVersion = $PSVersionTable.PSVersion.ToString(); passed = $false; cases = @() }
try {
    foreach ($expected in @(0, 7)) {
        $script = Join-Path $root ("exit-$expected.ps1")
        $stdout = Join-Path $root ("exit-$expected-out.txt")
        $stderr = Join-Path $root ("exit-$expected-error.txt")
        [IO.File]::WriteAllText($script, "[Console]::Out.WriteLine('stdout-$expected'); [Console]::Error.WriteLine('stderr-$expected'); Start-Sleep -Milliseconds 300; exit $expected")
        $child = $null
        $result = @{ expectedExitCode = $expected; handleRetained = $false; waitCompleted = $false; exitCode = $null; acceptedAsSuccess = $false }
        $report.cases += $result
        try {
            $child = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $script + '"')) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
            $childHandle = $child.Handle
            $result.handleRetained = $childHandle -ne [IntPtr]::Zero
            $result.waitCompleted = $child.WaitForExit(10000)
            if ($result.waitCompleted) {
                $child.WaitForExit()
                $result.exitCode = $child.ExitCode
            }
            $result.acceptedAsSuccess = $result.waitCompleted -and $null -ne $result.exitCode -and $result.exitCode -eq 0
            if (-not $result.handleRetained -or -not $result.waitCompleted -or $null -eq $result.exitCode -or $result.exitCode -ne $expected) { throw "Redirected child exit $expected was not observed exactly." }
            if ($result.acceptedAsSuccess -ne ($expected -eq 0)) { throw 'Nonzero child was not rejected by the success gate.' }
            if ((Get-Content -LiteralPath $stdout -Raw).Trim() -ne "stdout-$expected" -or (Get-Content -LiteralPath $stderr -Raw).Trim() -ne "stderr-$expected") { throw 'Redirected child output was not captured exactly.' }
        } finally {
            if ($child) {
                if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force }
                $child.Dispose()
            }
        }
    }
    $report.passed = $true
    Write-Host 'PASS: redirected Windows PowerShell children expose exact exit codes 0 and 7; only 0 passes the success gate.'
} finally {
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'process-exit-status.json') -Encoding UTF8
    Write-Host ('Controlled process regression status: ' + ($report | ConvertTo-Json -Depth 5 -Compress))
}

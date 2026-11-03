#requires -Version 5.1
param([Parameter(Mandatory = $true)][ValidateSet('install', 'start', 'seed', 'server', 'snapshot', 'cleanup')][string]$Action)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-QaPackage

switch ($Action) {
    'install' {
        foreach ($target in @($QaRuntime, $QaConfig, $QaData)) {
            if (Test-Path -LiteralPath $target) { throw "Existing QA material must be preserved: $target. Stop and ask the maintainer; do not delete it." }
        }
        foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
            if (Test-Path $registry) {
                $previous = @(Get-ChildItem $registry | Get-ItemProperty | Where-Object { $_.PSObject.Properties.Name -contains 'DisplayName' -and $_.DisplayName -eq 'Codex Monitor Updater QA' })
                if ($previous.Count) { throw 'An older QA installation is registered. Preserve it and ask the maintainer for a separate test profile.' }
            }
        }
        $webview = @()
        foreach ($registry in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE')) {
            $info = Get-ItemProperty "$registry\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
            if ($info -and $info.PSObject.Properties.Name -contains 'pv' -and $info.pv -ne '0.0.0.0') { $webview += $info.pv }
        }
        if (-not $webview.Count) { throw 'WebView2 Runtime was not detected. Ask the tester/maintainer to supply it before QA; this kit does not install prerequisites.' }
        Write-Host "Source: $($QaSource.sourceSha)"
        Write-Host "QA install only: $QaInstall"
        Write-Host 'The installer and QA executable do not have Authenticode signing. Follow your device policy; this script will not change SmartScreen or security settings.'
        if ((Read-Host 'Type INSTALL QA to install the isolated A application') -cne 'INSTALL QA') { throw 'Installation cancelled.' }
        New-Item -ItemType Directory -Path $QaRuntime | Out-Null
        New-Item -ItemType Directory -Path $QaHome, $QaEvidence | Out-Null
        Write-QaJson $QaMarker @{ sourceSha = $QaSource.sourceSha; runtime = $QaRuntime; packageRoot = $PackageRoot; createdAt = (Get-Date).ToString('o') }
        # /D is deliberately last and unquoted, as required by NSIS. The fixed
        # current-user QA destination cannot be selected as a production path.
        $installed = Start-Process -FilePath (Join-Path $PackageRoot 'A-0.0.1-setup.exe') -ArgumentList @('/S', "/D=$QaInstall") -Wait -PassThru
        if ($installed.ExitCode -ne 0) { throw "QA installer exit code: $($installed.ExitCode). Preserve this session and report it." }
        $binary = Get-QaBinary
        if ($binary.version -ne '0.0.1') { throw 'Expected freshly installed A.' }
        Write-QaJson (Join-Path $QaEvidence 'installation.json') @{ timestamp = (Get-Date).ToString('o'); installerExitCode = $installed.ExitCode; binary = $binary; webview2 = $webview; sourceSha = $QaSource.sourceSha }
        Write-Host 'A installed and its exact executable verified. Next: 02-Start-QA.cmd, save Windows settings, then exit A from its tray.'
    }
    'start' { Start-QaApplication }
    'seed' {
        Assert-QaSession
        Assert-QaStopped
        if ((Get-QaBinary).version -ne '0.0.1') { throw 'Synthetic sample must be seeded in A before upgrading.' }
        Add-QaSyntheticStats
        Write-Host 'Seeded only the isolated QA database: 12,345 input + 678 output = 13,023 tokens.'
        Start-QaApplication
    }
    'server' {
        Assert-QaSession
        & (Join-Path $PSScriptRoot 'server.ps1')
    }
    'snapshot' {
        Save-QaSnapshot (Read-Host 'Snapshot label (A-before-check / A-before-download / B-after-restart / B-cold-start)')
    }
    'cleanup' {
        Assert-QaSession
        Assert-QaStopped
        $stopFile = Join-Path $QaRuntime 'stop-server'
        [IO.File]::WriteAllText($stopFile, 'stop isolated QA loopback server')
        $deadline = (Get-Date).AddSeconds(10)
        do {
            $listening = @(Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue)
            if (-not $listening.Count) { break }
            Start-Sleep -Milliseconds 200
        } while ((Get-Date) -lt $deadline)
        if ($listening.Count) { throw 'Port 18765 still has a listener. Do not kill an unknown process; record it and ask the maintainer.' }
        Save-QaSnapshot 'cleanup'
        Write-Host 'QA exited; loopback listener stopped. QA evidence and installation are preserved; nothing was uninstalled or deleted.'
        Write-Host "Send the evidence folder and completed checklist to the maintainer: $QaEvidence"
    }
}

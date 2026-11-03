#requires -Version 5.1
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-QaSession
$stopFile = Join-Path $QaRuntime 'stop-server'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$requestLog = Join-Path $QaEvidence 'requests.jsonl'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), 18765)
$listener.Server.ExclusiveAddressUse = $true
try {
    $listener.Start()
    Write-QaJson (Join-Path $QaEvidence 'server.json') @{ pid = $PID; startedAt = (Get-Date).ToString('o'); address = '127.0.0.1'; port = 18765; sourceSha = $QaSource.sourceSha }
    Write-Host 'QA server: http://127.0.0.1:18765/latest.json'
    Write-Host 'Keep this window open. Before clicking Download, only /latest.json should appear. Stop with 06-Stop-Server-and-Check.cmd after exiting QA.'
    while (-not (Test-Path -LiteralPath $stopFile)) {
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $stream.WriteTimeout = 10000
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine()
            if (-not $request -or $request.Length -gt 4096) { throw 'Invalid QA request.' }
            $headerBytes = $request.Length
            for ($i = 0; $i -lt 100; $i++) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or $line -eq '') { break }
                $headerBytes += $line.Length
                if ($headerBytes -gt 16384) { throw 'Oversized QA request.' }
            }
            $fields = $request.Split(' ')
            $route = if ($fields.Length -eq 3) { $fields[1] } else { '' }
            $asset = if ($fields[0] -eq 'GET' -and $route -eq '/latest.json') { 'latest.json' } elseif ($fields[0] -eq 'GET' -and $route -eq '/B-0.0.2-setup.exe') { 'B-0.0.2-setup.exe' } else { $null }
            $status = if ($asset) { 200 } else { 404 }
            @{ at = (Get-Date).ToString('o'); method = $fields[0]; route = $route; status = $status } | ConvertTo-Json -Compress | Add-Content -LiteralPath $requestLog -Encoding UTF8
            Write-Host "$status $route"
            if ($asset) {
                $file = Join-Path $PackageRoot $asset
                Assert-NoReparse $file
                $body = [IO.File]::OpenRead($file)
                try {
                    $contentType = if ($asset -eq 'latest.json') { 'application/json' } else { 'application/octet-stream' }
                    $header = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n")
                    $stream.Write($header, 0, $header.Length)
                    $body.CopyTo($stream)
                    $stream.Flush()
                } finally { $body.Dispose() }
            } else {
                $response = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
                $stream.Write($response, 0, $response.Length)
            }
            $reader.Dispose()
        } catch {
            Write-Warning 'A QA HTTP request failed. Preserve requests.jsonl and retry manually; no installation was initiated by this server.'
        } finally { $client.Close() }
    }
} finally {
    $listener.Stop()
    Write-Host 'QA loopback server stopped.'
}

$ErrorActionPreference = 'Stop'
$familiarRoot = Split-Path -Parent $PSScriptRoot
$bardsongRoot = Join-Path (Split-Path -Parent $familiarRoot) 'campaign-soundpack\bardsong'
$targetRelative = '.local\sigil-session-005-auto-record.json'
$targetPath = Join-Path $familiarRoot $targetRelative
$localRoot = Join-Path $familiarRoot '.local'
$port = 4317

foreach ($required in @(
    (Join-Path $familiarRoot '.env'),
    (Join-Path $familiarRoot 'node_modules'),
    (Join-Path $bardsongRoot 'node_modules'),
    $targetPath
)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Tonight's Familiar + Bardsong runtime is missing a prepared local dependency: $required"
    }
}

try {
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1
    if ($existing.ok) { throw 'A Bardsong runtime is already active. Use its existing Chrome control room instead of starting a second Familiar process.' }
} catch {
    if ($_.Exception.Message -like 'A Bardsong runtime is already active*') { throw }
}

New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $localRoot "sigil-bardsong-$stamp.log"
$stderrPath = Join-Path $localRoot "sigil-bardsong-$stamp.error.log"

$env:BARDSONG_ENABLED = '1'
$env:BARDSONG_MANUAL_RECORDING_ONLY = '1'
$env:BARDSONG_TARGET_CONFIG = $targetRelative
$env:BARDSONG_APP_ROOT = $bardsongRoot
$env:BARDSONG_PORT = [string] $port

$runtime = Start-Process -FilePath 'node.exe' -ArgumentList 'bot.js' -WorkingDirectory $familiarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($runtime.HasExited) { throw "Familiar stopped during startup. See $stderrPath" }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1
            if ($health.ok) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 300 }
    }
    if (-not $ready) { throw "Familiar did not become ready. See $stderrPath" }

    $chromeCandidates = @(@(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    if (-not $chromeCandidates) { throw 'Google Chrome was not found on this PC.' }
    Start-Process -FilePath $chromeCandidates[0] -ArgumentList "http://127.0.0.1:$port" | Out-Null
    Write-Host 'Familiar + Bardsong is ready for tonight.' -ForegroundColor Green
    Write-Host 'The Discord gateway is online, but voice does not join until Connect Familiar audio is pressed.'
    Write-Host 'The scribe does not record until Ben explicitly runs !scribe start in the configured text room.'
    Write-Host 'Use Shut down tonight in the control room, or press Ctrl+C here, to stop everything cleanly.'
    Wait-Process -Id $runtime.Id
}
finally {
    if (-not $runtime.HasExited) {
        try {
            $session = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/session" -TimeoutSec 1
            Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/runtime/shutdown" -Headers @{ 'X-Bardsong-Token' = $session.token } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
            Wait-Process -Id $runtime.Id -Timeout 8 -ErrorAction SilentlyContinue
        } catch { }
    }
    if (-not $runtime.HasExited) { Stop-Process -Id $runtime.Id }
    foreach ($name in @('BARDSONG_ENABLED', 'BARDSONG_MANUAL_RECORDING_ONLY', 'BARDSONG_TARGET_CONFIG', 'BARDSONG_APP_ROOT', 'BARDSONG_PORT')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
}

param([switch]$GatewayOnly)
$ErrorActionPreference = 'Stop'
# User-invoked only. No startup task, schedule, worker, or credential printing.
$estate = Get-Content -LiteralPath 'C:\Ambitions\hq\estate-map.md' -Raw
$controlParts = $estate -split '## CONTROL BLOCK'
if ($controlParts.Count -ne 2) { throw 'Missing or ambiguous controls. No runtime was started.' }
$block = $controlParts[1] -split '\r?\n## ', 2
$authority = [regex]::Matches($block[0], '(?m)^- \*\*Authority: ([A-Z ]+)\*\*')
$clock = [regex]::Matches($block[0], '(?m)^- \*\*Clock: ([A-Z]+)\*\*')
if (-not $block -or $authority.Count -ne 1 -or $clock.Count -ne 1 -or
    $authority[0].Groups[1].Value -ne 'ACTIVE' -or $clock[0].Groups[1].Value -ne 'ON') {
    throw 'Fami is not ACTIVE/ON. No runtime was started.'
}
$wsl = Join-Path $env:WINDIR 'System32\wsl.exe'
$prefix = @('-d','Fami-Ubuntu','-u','fami','--exec','env',
    'PATH=/home/fami/.local/node-v24.20.0-linux-x64/bin:/usr/bin:/bin',
    '/home/fami/openclaw-runtime/bin/openclaw','--profile','fami')
function Test-FamiHealth {
    try {
        $response = Invoke-WebRequest 'http://127.0.0.1:19091/healthz' -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}
if (-not (Test-FamiHealth)) {
    Start-Process -FilePath $wsl -ArgumentList ($prefix + @('gateway','run','--port','19091','--bind','loopback','--auth','token','--tailscale','off','--compact')) -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not (Test-FamiHealth)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Gateway did not become ready within 45 seconds. Do not reinstall; return the error to Fami.' }
        Start-Sleep -Milliseconds 500
    }
}
# Verify authenticated native gateway access rather than trusting an HTTP port alone.
& $wsl @prefix gateway health
if ($LASTEXITCODE -ne 0) { throw 'Fami gateway authentication failed. No Companion was launched.' }
if (-not $GatewayOnly) {
    $companion = Join-Path $env:LOCALAPPDATA 'OpenClawTray\OpenClaw.Tray.WinUI.exe'
    if (-not (Test-Path -LiteralPath $companion)) {
        $companion = Join-Path $env:LOCALAPPDATA 'Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\OpenClawTray\OpenClaw.Tray.WinUI.exe'
    }
    if (-not (Test-Path -LiteralPath $companion)) { throw 'Companion executable missing. Do not reinstall automatically.' }
    # Run this launcher from normal Windows, not a Codex child process: Codex redirects AppData.
    Start-Process -FilePath $companion -ArgumentList 'openclaw://chat'
}

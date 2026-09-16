$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot

Write-Host 'Installing Bardsong dependencies inside the project...'
Push-Location $appRoot
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    Write-Host ''
    Write-Host 'Downloading the local speech model. This happens once and may take a few minutes...'
    npm run prepare:asr
    if ($LASTEXITCODE -ne 0) { throw 'local speech-model setup failed' }
    Write-Host ''
    Write-Host 'Bardsong is ready. Configure Discord next, then use Start Bardsong.cmd.' -ForegroundColor Green
}
finally {
    Pop-Location
}

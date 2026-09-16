$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$familiarLauncher = Join-Path (Split-Path -Parent (Split-Path -Parent $appRoot)) '20fates-familiar\scripts\start-sigil-bardsong.ps1'
if (-not (Test-Path -LiteralPath $familiarLauncher)) {
    throw 'The sibling 20fates-familiar project is missing. Bardsong must run inside Familiar so only one Discord client and voice connection exist.'
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $familiarLauncher
exit $LASTEXITCODE

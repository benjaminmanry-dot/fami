param([string]$BaseUrl='http://127.0.0.1:8790',[string]$RestoreUrl='http://127.0.0.1:8791')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
if(([Uri]$BaseUrl).Host -notin @('localhost','127.0.0.1') -or ([Uri]$RestoreUrl).Host -notin @('localhost','127.0.0.1')) { throw 'This recovery rehearsal is local only.' }
try {
  $taskSecure=Get-Content -LiteralPath (Join-Path $taskRoot '.private/owner.dpapi') -Raw | ConvertTo-SecureString
  $env:ROOKERY_OWNER_TOKEN=[Net.NetworkCredential]::new('',$taskSecure).Password
  $env:ROOKERY_URL=$BaseUrl
  $env:ROOKERY_RESTORE_URL=$RestoreUrl
  node (Join-Path $taskRoot 'tests/boundaries.mjs')
  if($LASTEXITCODE -ne 0){throw 'Boundary rehearsal failed; inspect the reported check.'}
} finally {
  Remove-Item Env:ROOKERY_OWNER_TOKEN,Env:ROOKERY_URL,Env:ROOKERY_RESTORE_URL -ErrorAction SilentlyContinue
}

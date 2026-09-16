$ErrorActionPreference = 'Stop'
$rookeryRoot = Split-Path -Parent $PSScriptRoot
$rookeryPrivate = Join-Path $rookeryRoot '.private'
New-Item -ItemType Directory -Path $rookeryPrivate -Force | Out-Null
$rookeryHashes = @{}
foreach ($rookeryName in @('owner','fami','ip-salt')) {
  $rookeryPath = Join-Path $rookeryPrivate ($rookeryName + '.dpapi')
  if (-not (Test-Path -LiteralPath $rookeryPath)) {
    $rookeryBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $rookeryToken = 'rk_' + [Convert]::ToBase64String($rookeryBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    $rookerySecure = ConvertTo-SecureString $rookeryToken -AsPlainText -Force
    ConvertFrom-SecureString $rookerySecure | Set-Content -LiteralPath $rookeryPath -NoNewline
  }
  $rookerySecure = Get-Content -LiteralPath $rookeryPath -Raw | ConvertTo-SecureString
  $rookeryToken = [Net.NetworkCredential]::new('', $rookerySecure).Password
  $rookeryHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($rookeryToken))).ToLowerInvariant()
  $rookeryHashes[$rookeryName] = $rookeryHash
}
$rookeryLocal = @("ROOKERY_OWNER_HASH=$($rookeryHashes['owner'])", "ROOKERY_FAMI_HASH=$($rookeryHashes['fami'])", "ROOKERY_IP_SALT=$($rookeryHashes['ip-salt'])")
$rookeryLocal | Set-Content -LiteralPath (Join-Path $rookeryRoot '.env.local') -Encoding utf8NoBOM
$rookeryHashes | ConvertTo-Json -Compress

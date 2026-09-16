param([Parameter(Mandatory=$true)][string]$BaseUrl)
$ErrorActionPreference='Stop'
$rookeryRoot=Split-Path -Parent $PSScriptRoot
$rookeryPrivate=Join-Path $rookeryRoot '.private/backups'
New-Item -ItemType Directory -Path $rookeryPrivate -Force | Out-Null
$rookeryOrigin=[Uri]$BaseUrl
if ($rookeryOrigin.Host -notin @('127.0.0.1','localhost','the-rookery.benjamin-manry.chatgpt.site') -or ($rookeryOrigin.Host -eq 'the-rookery.benjamin-manry.chatgpt.site' -and $rookeryOrigin.Scheme -ne 'https')) { throw 'Unapproved credential destination.' }
$rookerySecure=Get-Content -LiteralPath (Join-Path $rookeryRoot '.private/owner.dpapi') -Raw | ConvertTo-SecureString
$rookeryHeaders=@{Authorization='Bearer '+[Net.NetworkCredential]::new('', $rookerySecure).Password}
function Invoke-RookeryBackupRequest([string]$Path,$Body=$null) {
    $rookeryRequest=@{Uri=($BaseUrl.TrimEnd('/')+'/api/v1/owner/'+$Path);Headers=$rookeryHeaders;Method='Get';MaximumRedirection=0}
    if($null -ne $Body) {
        $rookeryHeaders['Idempotency-Key']=[guid]::NewGuid().ToString()
        $rookeryRequest.Method='Post'
        $rookeryRequest.ContentType='application/json'
        $rookeryRequest.Body=$Body|ConvertTo-Json -Compress
    }
    Invoke-RestMethod @rookeryRequest
}
$rookeryBefore=Invoke-RookeryBackupRequest 'dashboard'
$rookeryControls=@{registration_open=[bool]$rookeryBefore.status.registration_open;writes_open=[bool]$rookeryBefore.status.writes_open}
$rookeryStamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$rookeryOutput=Join-Path $rookeryPrivate ($rookeryStamp+'.json.dpapi')
try {
    Invoke-RookeryBackupRequest 'controls' @{registration_open=$false;writes_open=$false} | Out-Null
    $rookeryExport=Invoke-RookeryBackupRequest 'export'
    $rookeryJson=$rookeryExport | ConvertTo-Json -Depth 100 -Compress
    # No plaintext dump on disk or in output. This Windows account can decrypt it.
    $rookeryEncrypted=ConvertFrom-SecureString (ConvertTo-SecureString $rookeryJson -AsPlainText -Force)
    [IO.File]::WriteAllText($rookeryOutput,$rookeryEncrypted,[Text.UTF8Encoding]::new($false))
    [pscustomobject]@{saved=$true;file=$rookeryOutput;sha256=(Get-FileHash -LiteralPath $rookeryOutput -Algorithm SHA256).Hash}
} finally {
    Invoke-RookeryBackupRequest 'controls' $rookeryControls | Out-Null
}

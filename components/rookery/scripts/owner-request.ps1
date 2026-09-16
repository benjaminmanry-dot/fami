param([string]$BaseUrl='http://127.0.0.1:8790',[Parameter(Mandatory=$true)][string]$Path,[string]$BodyFile,[string]$OutputFile,[string]$IdempotencyKey,[ValidateSet('owner','fami')][string]$Identity='owner')
$ErrorActionPreference='Stop'
$rookeryRoot=Split-Path -Parent $PSScriptRoot
$rookeryOrigin=[Uri]$BaseUrl
if ($rookeryOrigin.Host -notin @('127.0.0.1','localhost','the-rookery.benjamin-manry.chatgpt.site') -or ($rookeryOrigin.Host -eq 'the-rookery.benjamin-manry.chatgpt.site' -and $rookeryOrigin.Scheme -ne 'https')) { throw 'Unapproved credential destination.' }
if (-not $Path.StartsWith('/api/v1/') -or $Path.Contains('..') -or $Path.Contains('?token')) { throw 'Use a Rookery API path.' }
$rookerySecret=Get-Content -LiteralPath (Join-Path $rookeryRoot ('.private/'+$Identity+'.dpapi')) -Raw | ConvertTo-SecureString
$rookeryToken=[Net.NetworkCredential]::new('', $rookerySecret).Password
$rookeryHeaders=@{Authorization='Bearer '+$rookeryToken}
$rookeryArguments=@{Uri=($BaseUrl.TrimEnd('/')+$Path);Headers=$rookeryHeaders;Method='Get';MaximumRedirection=0}
if ($BodyFile) { $rookeryHeaders['Idempotency-Key']=if($IdempotencyKey){$IdempotencyKey}else{[guid]::NewGuid().ToString()};$rookeryArguments.Method='Post';$rookeryArguments.ContentType='application/json';$rookeryArguments.Body=Get-Content -LiteralPath $BodyFile -Raw }
$rookeryResponse=Invoke-RestMethod @rookeryArguments
if($OutputFile){$rookeryResponse|ConvertTo-Json -Depth 60|Set-Content -LiteralPath $OutputFile -Encoding utf8NoBOM;Write-Output 'Response saved privately.'}else{$rookeryResponse|ConvertTo-Json -Depth 12}

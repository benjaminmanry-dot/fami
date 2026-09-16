[CmdletBinding()]
param([ValidateSet('Status','Work')][string]$Purpose = 'Status')
$ErrorActionPreference = 'Stop'
try {
    $games = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -in @('EscapeFromTarkov','EscapeFromTarkov_BE','EscapeFromTarkovArena','EscapeFromTarkovArena_BE') })
    [ordered]@{ checkedAtUtc = [DateTime]::UtcNow.ToString('o'); gaming = ($games.Count -gt 0); deferHeavyWork = ($games.Count -gt 0); processes = @($games | Select-Object ProcessName,Id); permissionGranted = $false } | ConvertTo-Json -Depth 4 -Compress
    if ($Purpose -eq 'Work' -and $games.Count -gt 0) { exit 75 }
    exit 0
} catch {
    [ordered]@{ checkedAtUtc = [DateTime]::UtcNow.ToString('o'); gaming = $null; deferHeavyWork = $true; reason = 'Process inspection unavailable'; permissionGranted = $false } | ConvertTo-Json -Compress
    exit 75
}

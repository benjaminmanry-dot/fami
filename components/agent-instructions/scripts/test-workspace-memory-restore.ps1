[CmdletBinding()]
param(
    [string]$LiveCodexHome = (Join-Path $env:USERPROFILE ".codex")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$workspaceScript = Join-Path $PSScriptRoot "workspace.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "workspace-memory-restore-test-$([guid]::NewGuid().ToString('N'))"

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw "TEST FAILED: $Message"
    }
}

function Get-TomlValues([string]$Path) {
    $section = ""
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^\[([^\]]+)\]$') {
            $section = $Matches[1]
        } elseif ($trimmed -match '^([A-Za-z0-9_.-]+)\s*=\s*(.+)$') {
            $values["$section|$($Matches[1])"] = $Matches[2].Trim()
        }
    }
    return $values
}

function Get-Fingerprint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }
    $root = (Resolve-Path -LiteralPath $Path).Path.TrimEnd("\") + "\"
    return @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force |
        Sort-Object FullName |
        ForEach-Object { "$($_.FullName.Substring($root.Length).Replace('\', '/'))`t$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" })
}

try {
    $liveConfig = Join-Path $LiveCodexHome "config.toml"
    $liveConfigHash = (Get-FileHash -LiteralPath $liveConfig -Algorithm SHA256).Hash
    $memoriesBefore = Get-Fingerprint (Join-Path $LiveCodexHome "memories")

    $testCodexHome = Join-Path $testRoot "codex"
    $testClaudeHome = Join-Path $testRoot "claude"
    New-Item -ItemType Directory -Path $testCodexHome | Out-Null
    $testConfig = Join-Path $testCodexHome "config.toml"
    Copy-Item -LiteralPath (Join-Path $repoRoot "global\behavior-config.toml") -Destination $testConfig

    $lines = [System.Collections.Generic.List[string]]::new()
    $foundMemoryUse = $false
    foreach ($line in Get-Content -LiteralPath $testConfig -Encoding UTF8) {
        if ($line -match '^\s*use_memories\s*=') {
            $lines.Add("use_memories = false")
            $foundMemoryUse = $true
        } else {
            $lines.Add($line)
        }
    }
    Assert-That $foundMemoryUse "fixture lacks memories.use_memories"
    $lines.Add("")
    $lines.Add("[machine_only]")
    $lines.Add('preserve_me = "yes"')
    [System.IO.File]::WriteAllLines($testConfig, $lines, [System.Text.UTF8Encoding]::new($false))

    $beforeHash = (Get-FileHash -LiteralPath $testConfig -Algorithm SHA256).Hash
    $before = Get-TomlValues $testConfig
    & powershell -NoProfile -ExecutionPolicy Bypass -File $workspaceScript -Action restore-memory -Apply -CodexHome $testCodexHome -ClaudeHome $testClaudeHome
    Assert-That ($LASTEXITCODE -eq 0) "restore-memory returned $LASTEXITCODE"

    $after = Get-TomlValues $testConfig
    $allKeys = @($before.Keys + $after.Keys | Sort-Object -Unique)
    $changed = @($allKeys | Where-Object { -not $before.ContainsKey($_) -or -not $after.ContainsKey($_) -or $before[$_] -ne $after[$_] })
    Assert-That ($changed.Count -eq 1 -and $changed[0] -eq "memories|use_memories") "restore changed a non-target setting"
    Assert-That ($after["memories|use_memories"] -eq "true") "restore did not enable memory use"
    Assert-That ($after["machine_only|preserve_me"] -eq '"yes"') "restore did not preserve a machine-only setting"
    Assert-That ((Get-FileHash -LiteralPath (Join-Path $testCodexHome "AGENTS.md") -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath (Join-Path $repoRoot "global\AGENTS.md") -Algorithm SHA256).Hash) "rulebook was not restored"
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $testClaudeHome "CLAUDE.md"))) "selective restore touched Claude"
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $testCodexHome "skills"))) "selective restore touched skills"

    $backup = @(Get-ChildItem -LiteralPath (Join-Path $testCodexHome "backups") -Directory -Filter "codex-memory-use-*")
    Assert-That ($backup.Count -eq 1) "selective restore did not create exactly one backup"
    Assert-That ((Get-FileHash -LiteralPath (Join-Path $backup[0].FullName "config.toml") -Algorithm SHA256).Hash -eq $beforeHash) "backup does not match the pre-restore config"
    Assert-That ((Get-FileHash -LiteralPath $liveConfig -Algorithm SHA256).Hash -eq $liveConfigHash) "test changed the live config"
    Assert-That ((Get-Fingerprint (Join-Path $LiveCodexHome "memories")) -join "`n" -eq ($memoriesBefore -join "`n")) "test changed generated memories"

    Write-Host "PASS: restore-memory is selective, recoverable, and leaves live state untouched."
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolved = (Resolve-Path -LiteralPath $testRoot).Path
        $tempRoot = (Resolve-Path -LiteralPath ([System.IO.Path]::GetTempPath())).Path.TrimEnd("\") + "\"
        Assert-That $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) "unsafe temporary cleanup target"
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

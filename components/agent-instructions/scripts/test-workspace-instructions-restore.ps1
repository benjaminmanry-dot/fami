[CmdletBinding()]
param(
    [string]$WorkspaceScript,
    [Parameter(Mandatory = $true)][string]$TestRoot
)

$ErrorActionPreference = 'Stop'
if (-not $WorkspaceScript) { $WorkspaceScript = Join-Path $PSScriptRoot 'workspace.ps1' }
if (Test-Path -LiteralPath $TestRoot) { throw 'Use a new isolated test directory.' }
$testPath = [IO.Path]::GetFullPath($TestRoot)
if ($testPath -eq [IO.Path]::GetPathRoot($testPath)) { throw 'A drive root is not a test directory.' }
New-Item -ItemType Directory -Path $testPath | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-TestFile([string]$Path, [string]$Text) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($testPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test write outside its directory.' }
    New-Item -ItemType Directory -Path (Split-Path $full -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($full, $Text, $utf8)
}
function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "TEST FAILED: $Message" }
}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Fingerprint([string]$Root) {
    @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName | ForEach-Object { "$($_.FullName):$(Hash $_.FullName)" }) -join "`n"
}

$sourceRoot = Join-Path $testPath 'source'
$script = Join-Path $sourceRoot 'scripts\workspace.ps1'
Write-TestFile $script ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $WorkspaceScript)))
Write-TestFile (Join-Path $sourceRoot 'global\AGENTS.md') "Canonical rules`n"
Write-TestFile (Join-Path $sourceRoot 'global\behavior-config.toml') "model = `"gpt-5.6-sol`"`nsandbox_mode = `"workspace-write`"`n[memories]`nuse_memories = true`n"
Write-TestFile (Join-Path $sourceRoot 'skills\sample\SKILL.md') "Canonical skill`n"
Write-TestFile (Join-Path $sourceRoot 'skills\sample\references\source.md') "Source procedure`n"
$codex = Join-Path $testPath 'codex'
$claude = Join-Path $testPath 'claude'
$config = Join-Path $codex 'config.toml'
Write-TestFile $config "# Preserve formatting and owner choices`r`nmodel = `"gpt-6-astra`"`r`nsandbox_mode = `"danger-full-access`"`r`n[memories]`r`nuse_memories = false`r`n[machine_only]`r`nvalue = 17`r`n"
Write-TestFile (Join-Path $codex 'AGENTS.md') "Old rules`n"
Write-TestFile (Join-Path $claude 'CLAUDE.md') "Old pointer`n"
Write-TestFile (Join-Path $codex 'skills\sample\SKILL.md') "Old skill`n"
Write-TestFile (Join-Path $codex 'skills\sample\stale.md') "Keep in recovery`n"
Write-TestFile (Join-Path $codex 'skills\unmanaged\SKILL.md') "Unmanaged skill`n"
$before = Fingerprint $testPath
$ErrorActionPreference = 'Continue'
$preview = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action restore-instructions -CodexHome $codex -ClaudeHome $claude 2>&1
$ErrorActionPreference = 'Stop'
Assert-That ($LASTEXITCODE -eq 0) 'instruction-only preview is unavailable or failed'
Assert-That ((Fingerprint $testPath) -eq $before) 'preview changed a file'

$override = Join-Path $codex 'AGENTS.override.md'
Write-TestFile $override "Owner override`n"
$blockedBefore = Fingerprint $testPath
$ErrorActionPreference = 'Continue'
$blocked = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action restore-instructions -Apply -CodexHome $codex -ClaudeHome $claude 2>&1
$ErrorActionPreference = 'Stop'
Assert-That ($LASTEXITCODE -ne 0) 'nonempty override did not block restoration'
Assert-That ((Fingerprint $testPath) -eq $blockedBefore) 'blocked restore changed files'
# Both resolved paths are inside this new isolated test directory; preserve the fixture.
Move-Item -LiteralPath $override -Destination (Join-Path $codex 'override-preserved.md')
$oldConfig = Hash $config
$oldRules = Hash (Join-Path $codex 'AGENTS.md')
$oldSkill = Hash (Join-Path $codex 'skills\sample\SKILL.md')
$oldPointer = Hash (Join-Path $claude 'CLAUDE.md')
$oldUnmanaged = Hash (Join-Path $codex 'skills\unmanaged\SKILL.md')
$result = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action restore-instructions -Apply -CodexHome $codex -ClaudeHome $claude 2>&1
Assert-That ($LASTEXITCODE -eq 1) 'full checker should still disclose deliberately different portable settings'
$failures = @($result | Where-Object { "$_" -like 'FAIL:*' })
Assert-That ($failures.Count -eq 3 -and @($failures | Where-Object { "$_" -notlike "FAIL: Portable setting '*' differs from the live config." }).Count -eq 0) 'restore/check reported an unexpected failure'
Assert-That ((Hash $config) -eq $oldConfig) 'instruction restore changed configuration bytes'
Assert-That ((Hash (Join-Path $codex 'AGENTS.md')) -eq (Hash (Join-Path $sourceRoot 'global\AGENTS.md'))) 'rulebook not restored'
Assert-That ((Hash (Join-Path $codex 'skills\sample\SKILL.md')) -eq (Hash (Join-Path $sourceRoot 'skills\sample\SKILL.md'))) 'skill not restored'
Assert-That (Test-Path -LiteralPath (Join-Path $codex 'skills\sample\references\source.md')) 'skill reference missing'
Assert-That (-not (Test-Path -LiteralPath (Join-Path $codex 'skills\sample\stale.md'))) 'stale active skill file survived'
Assert-That ((Hash (Join-Path $codex 'skills\unmanaged\SKILL.md')) -eq $oldUnmanaged) 'unmanaged skill changed'
Assert-That ([IO.File]::ReadAllText((Join-Path $claude 'CLAUDE.md')).Contains("@$(Join-Path $sourceRoot 'global\AGENTS.md')")) 'Claude pointer not restored'
$backups = @(Get-ChildItem -LiteralPath (Join-Path $codex 'backups') -Directory)
Assert-That ($backups.Count -eq 1) 'expected one recovery directory'
$backup = $backups[0].FullName
Assert-That ((Hash (Join-Path $backup 'AGENTS.md')) -eq $oldRules) 'old rulebook not recoverable'
Assert-That ((Hash (Join-Path $backup 'CLAUDE.md')) -eq $oldPointer) 'old pointer not recoverable'
Assert-That ((Hash (Join-Path $backup 'skills\sample\SKILL.md')) -eq $oldSkill) 'old skill not recoverable'
Assert-That (Test-Path -LiteralPath (Join-Path $backup 'skills\sample\stale.md')) 'stale file was deleted instead of preserved'

$fullCodex = Join-Path $testPath 'full-codex'
$fullClaude = Join-Path $testPath 'full-claude'
Write-TestFile (Join-Path $fullCodex 'config.toml') ([IO.File]::ReadAllText($config))
$fullResult = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action restore -Apply -CodexHome $fullCodex -ClaudeHome $fullClaude 2>&1
Assert-That ($LASTEXITCODE -eq 2) 'legacy full restore should pass with only the fixture Git-history warning'
$fullConfig = [IO.File]::ReadAllText((Join-Path $fullCodex 'config.toml'))
Assert-That ($fullConfig.Contains('model = "gpt-5.6-sol"') -and $fullConfig.Contains('use_memories = true') -and $fullConfig.Contains('value = 17')) 'legacy full restore no longer applies portable settings while retaining machine-only fields'

Write-TestFile (Join-Path $codex 'AGENTS.md') "Deliberately corrupt restored rules`n"
$check = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action check -CodexHome $codex -ClaudeHome $claude 2>&1
Assert-That ($LASTEXITCODE -eq 1 -and ($check -join "`n").Contains('The live global instructions and recovery copy differ.')) 'checker missed deliberately broken instructions'
Write-Output 'PASS: preview and override are nonmutating; rules/skills restore with exact backups; configuration and unmanaged skills survive; drift remains honestly reported.'
Write-Output "Evidence preserved in $testPath. No real agent home was used."

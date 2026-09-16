[CmdletBinding()]
param(
    [string]$Character = "Brol",
    [string]$Server = "rivervale",
    [string]$InstallRoot = "C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends",
    [string]$OutputRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
    $OutputRoot = Join-Path $projectRoot "snapshots"
}
if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    throw "EQL install not found: $InstallRoot"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$snapshotRoot = Join-Path $OutputRoot (Join-Path $Character $stamp)
$rawRoot = Join-Path $snapshotRoot "raw"
New-Item -ItemType Directory -Path $rawRoot -Force | Out-Null

function Newest([string]$Filter) {
    Get-ChildItem -LiteralPath $InstallRoot -Filter $Filter -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Preserve([System.IO.FileInfo]$File) {
    if ($null -ne $File) {
        Copy-Item -LiteralPath $File.FullName -Destination (Join-Path $rawRoot $File.Name)
    }
}

$inventory = Newest "${Character}_${Server}-Inventory.txt"
$spellbook = Newest "${Character}_${Server}-Spellbook.txt"
$missingSpells = Newest "${Character}_${Server}-MissingSpells.txt"
$achievements = Newest "${Character}_${Server}-Achievements.txt"
$faction = Newest "${Character}_${Server}-Faction.txt"
$log = Get-Item -LiteralPath (Join-Path $InstallRoot "Logs\eqlog_${Character}_${Server}.txt") -ErrorAction SilentlyContinue
$loadout = Newest "${Character}_${Server}_LO*.ini"
$layout = Newest "UI_${Character}_${Server}_LO*.ini"
$skinLayout = Newest "UI_BrolComplete_${Server}_LO*.ini"
$uiErrors = Get-Item -LiteralPath (Join-Path $InstallRoot "UIErrors.txt") -ErrorAction SilentlyContinue
Write-Verbose "Located native exports and client files."

@($inventory, $spellbook, $missingSpells, $achievements, $faction, $loadout, $layout, $skinLayout, $uiErrors) |
    Where-Object { $null -ne $_ } |
    ForEach-Object { Preserve $_ }
Write-Verbose "Preserved available raw files."

$wornSlots = @(
    "Any Slot", "Charm", "Ear", "Head", "Face", "Neck", "Shoulders", "Arms",
    "Back", "Wrist", "Range", "Hands", "Primary", "Secondary", "Fingers",
    "Chest", "Legs", "Feet", "Waist", "Power Source", "Ammo"
)
$equipped = @()
if ($null -ne $inventory) {
    $equipped = @(Import-Csv -LiteralPath $inventory.FullName -Delimiter "`t" |
        Where-Object { $wornSlots -contains $_.Location -and $_.Name -and $_.Name -ne "Empty" } |
        Select-Object Location, Name, ID, Count)
}
Write-Verbose "Parsed equipped inventory."

$level = $null
$zone = $null
$stance = $null
$invocation = $null
$sessionStart = $null
$session = [ordered]@{
    Kills = 0
    Deaths = 0
    ItemMustBeEquippedErrors = 0
    OutOfAmmoWarnings = 0
    OutOfFoodDrinkWarnings = 0
}
$recentUpgrades = [System.Collections.Generic.List[string]]::new()
$mechanicalLines = [System.Collections.Generic.List[string]]::new()

if ($null -ne $log) {
    Write-Verbose "Scanning mechanical log events."
    $logPattern = 'Welcome to EverQuest Legends!|Welcome to level \d+!|You have entered |You assume (?:a|an) .+ stance\.|You begin reciting the .+ invocation\.|You have slain |You have been slain |You cannot use this item unless it is equipped\.|You have run out of ammo!|You are out of food and drink\.| to create (?:a |an )?.+ \+\d+$|Your .+ spell has worn off'
    foreach ($match in Select-String -LiteralPath $log.FullName -Pattern $logPattern) {
        $line = $match.Line
        $separator = $line.IndexOf('] ')
        if ($separator -ge 0) {
            $message = $line.Substring($separator + 2)
            $keep = $false
            if ($message -eq "Welcome to EverQuest Legends!") {
                $sessionStart = $line.Substring(1, $separator - 1)
                $session.Kills = 0
                $session.Deaths = 0
                $session.ItemMustBeEquippedErrors = 0
                $session.OutOfAmmoWarnings = 0
                $session.OutOfFoodDrinkWarnings = 0
                $recentUpgrades.Clear()
                $mechanicalLines.Clear()
            } elseif ($message.Contains('Welcome to level ') -and $message -match 'Welcome to level (?<level>\d+)!') {
                $level = [int]$Matches.level
                $keep = $true
            } elseif ($message.StartsWith('You have entered ') -and $message.EndsWith('.')) {
                $zone = $message.Substring(17, $message.Length - 18)
                $keep = $true
            } elseif ($message.StartsWith('You assume ') -and $message -match '^You assume (?:a|an) (?<stance>.+) stance\.$') {
                $stance = $Matches.stance
                $keep = $true
            } elseif ($message.StartsWith('You begin reciting the ') -and $message -match '^You begin reciting the (?<invocation>.+) invocation\.$') {
                $invocation = $Matches.invocation
                $keep = $true
            } elseif ($message.StartsWith('You have slain ')) {
                $session.Kills++
                $keep = $true
            } elseif ($message.StartsWith('You have been slain ')) {
                $session.Deaths++
                $keep = $true
            } elseif ($message -eq 'You cannot use this item unless it is equipped.') {
                $session.ItemMustBeEquippedErrors++
                $keep = $true
            } elseif ($message -eq 'You have run out of ammo!') {
                $session.OutOfAmmoWarnings++
                $keep = $true
            } elseif ($message -eq 'You are out of food and drink.') {
                $session.OutOfFoodDrinkWarnings++
                $keep = $true
            } elseif ($message.Contains(' to create ') -and $message -match ' to create (?:a |an )?(?<item>.+ \+\d+)$') {
                $recentUpgrades.Add($Matches.item)
                $keep = $true
            } elseif ($message.StartsWith('Your ') -and $message.Contains(' spell has worn off')) {
                $keep = $true
            }
            if ($keep) {
                $mechanicalLines.Add($line)
            }
        }
    }
}
Write-Verbose "Parsed mechanical log events."

$buttonLabels = @()
$autoSkills = @()
if ($null -ne $loadout) {
    foreach ($line in Get-Content -LiteralPath $loadout.FullName) {
        if ($line -match '^Page\d+Button\d+=.*,(?<label>[^,]+),?$' -and $Matches.label -notmatch '^[0-9A-Fa-f]{8,}$') {
            $buttonLabels += $Matches.label.Replace('<BR>', ' ')
        }
        if ($line -match '^AutoSkillsLO\d+=') { $autoSkills += $line }
    }
    $buttonLabels = @($buttonLabels | Where-Object { $_ -and $_ -ne '0' } | Sort-Object -Unique)
}
Write-Verbose "Parsed loadout."

$now = Get-Date
function ExportState([System.IO.FileInfo]$File) {
    if ($null -eq $File) { return [ordered]@{ Status = "missing" } }
    $age = ($now - $File.LastWriteTime).TotalMinutes
    [ordered]@{
        Status = if ($age -le 30) { "fresh" } else { "stale" }
        Path = $File.FullName
        Written = $File.LastWriteTime.ToString("o")
        AgeMinutes = [math]::Round($age, 1)
    }
}

$snapshot = [ordered]@{
    Character = $Character
    Server = $Server
    Captured = $now.ToString("o")
    LatestKnownLevel = $level
    LatestKnownZone = $zone
    LatestKnownStance = $stance
    LatestKnownInvocation = $invocation
    LatestLoadoutFile = if ($null -ne $loadout) { $loadout.Name } else { $null }
    HotbuttonLabels = $buttonLabels
    AutoSkills = $autoSkills
    Equipped = $equipped
    RecentItemUpgrades = @($recentUpgrades | Select-Object -Last 30)
    LastLogSession = [ordered]@{ Started = $sessionStart; Counters = $session }
    Exports = [ordered]@{
        Inventory = ExportState $inventory
        Spellbook = ExportState $spellbook
        MissingSpells = ExportState $missingSpells
        Achievements = ExportState $achievements
        Faction = ExportState $faction
        Log = ExportState $log
    }
    Limits = @(
        "EQL exposes no supported file export for live HP, mana, endurance, AC, attack, or the purchased-AA table.",
        "Equipped gear is authoritative only when the inventory export is fresh.",
        "Dragon Hoard contents appear only when the hoard is open during /outputfile inventory."
    )
}

$snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $snapshotRoot "snapshot.json") -Encoding UTF8
$mechanicalLines | Select-Object -Last 2500 | Set-Content -LiteralPath (Join-Path $snapshotRoot "mechanical-log.txt") -Encoding UTF8
Write-Verbose "Wrote machine-readable snapshot."

$summary = [System.Collections.Generic.List[string]]::new()
$summary.Add("# $Character character snapshot")
$summary.Add("")
$summary.Add("Captured: $($now.ToString('yyyy-MM-dd HH:mm:ss zzz'))")
$summary.Add("")
$summary.Add("- Level: $(if ($null -ne $level) { $level } else { 'unknown' })")
$summary.Add("- Zone: $(if ($zone) { $zone } else { 'unknown' })")
$summary.Add("- Stance: $(if ($stance) { $stance } else { 'unknown' })")
$summary.Add("- Invocation: $(if ($invocation) { $invocation } else { 'unknown' })")
$summary.Add("- Loadout file: $(if ($null -ne $loadout) { $loadout.Name } else { 'missing' })")
$summary.Add("")
$summary.Add("## Equipped gear")
$summary.Add("")
if ($equipped.Count) {
    foreach ($item in $equipped) { $summary.Add("- $($item.Location): $($item.Name)") }
} else {
    $summary.Add("- Unknown. In EQL run `/outputfile inventory`, then run this collector again.")
}
$summary.Add("")
$summary.Add("## Current-session warnings")
$summary.Add("")
foreach ($key in $session.Keys) { $summary.Add("- ${key}: $($session[$key])") }
$summary.Add("")
$summary.Add("## Native exports")
$summary.Add("")
foreach ($key in $snapshot.Exports.Keys) { $summary.Add("- ${key}: $($snapshot.Exports[$key].Status)") }
$summary.Add("")
$summary.Add("Raw exports and agent-readable `snapshot.json` are beside this file.")
$summary | Set-Content -LiteralPath (Join-Path $snapshotRoot "SUMMARY.md") -Encoding UTF8
Write-Verbose "Wrote human-readable summary."

Write-Host "BROL_SNAPSHOT=$snapshotRoot"
if ($null -eq $inventory -or ($now - $inventory.LastWriteTime).TotalMinutes -gt 30) {
    Write-Warning "Inventory is missing or stale. In EQL run /outputfile inventory, then collect again."
}
if ($null -eq $spellbook -or ($now - $spellbook.LastWriteTime).TotalMinutes -gt 30) {
    Write-Warning "Spellbook is missing or stale. In EQL run /outputfile spellbook, then collect again."
}

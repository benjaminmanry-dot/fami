param(
    [string] $OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'test\fixtures\roll-initiative.wav'),
    [string] $Text = 'Roll initiative. The hobgoblins charge.'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$folder = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$voice = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $voice.Rate = -1
    $voice.SetOutputToWaveFile($OutputPath)
    $voice.Speak($Text)
}
finally {
    $voice.Dispose()
}
Write-Host "Owned synthetic speech fixture written to $OutputPath"

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "dist\\index.html")) {
  throw "Missing dist\\index.html. Run the production build first."
}

if (Test-Path "20fates-netlify-dist.zip") {
  Remove-Item "20fates-netlify-dist.zip" -Force
}

# Use tar to preserve portable zip paths for Netlify drag-and-drop deploys.
cmd /c tar -a -c -f 20fates-netlify-dist.zip -C dist .

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Resolve-Path "20fates-netlify-dist.zip"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zip.Entries | Select-Object -ExpandProperty FullName
$zip.Dispose()

$hasRootIndex = $entries -contains "./index.html"
$hasCompiledCss = ($entries | Where-Object { $_ -like "./assets/*.css" }).Count -gt 0

if (-not $hasRootIndex) {
  throw "Zip validation failed: ./index.html missing at archive root."
}

if (-not $hasCompiledCss) {
  throw "Zip validation failed: compiled CSS missing in ./assets."
}

Write-Output "Created 20fates-netlify-dist.zip"
Write-Output "Verified: ./index.html and compiled CSS in ./assets present"

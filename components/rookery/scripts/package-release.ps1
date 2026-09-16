param(
  [Parameter(Mandatory=$true)][string]$PrepareScript,
  [Parameter(Mandatory=$true)][string]$Archive
)
$ErrorActionPreference='Stop'
$rookeryRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$rookeryWork=Join-Path $rookeryRoot 'work'
$rookeryStage=[IO.Path]::GetFullPath((Join-Path $rookeryWork ('package-'+[guid]::NewGuid().ToString('N'))))
$rookeryDist=Join-Path $rookeryStage 'dist'
if(-not $rookeryStage.StartsWith($rookeryWork+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $rookeryStage)){throw 'A fresh project-local stage is required.'}
$rookeryArchive=[IO.Path]::GetFullPath($Archive)
if(-not $rookeryArchive.StartsWith((Join-Path $rookeryRoot '.private')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $rookeryArchive)){throw 'Use a new archive under the project private directory.'}
# The bundled preparer validates regular files and build boundaries. Its removal
# target is the verified fresh dist directory above, which does not yet exist.
node $PrepareScript $rookeryRoot $rookeryDist
if($LASTEXITCODE -ne 0){throw 'Sites build preparation failed.'}
$rookeryMeta=Join-Path $rookeryDist '.openai'
New-Item -ItemType Directory -Path $rookeryMeta -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $rookeryRoot '.openai/hosting.json') -Destination (Join-Path $rookeryMeta 'hosting.json') -Force
$rookeryMigrations=Join-Path $rookeryRoot 'drizzle'
if(Test-Path -LiteralPath $rookeryMigrations){
  $rookeryMigrationOutput=Join-Path $rookeryMeta 'drizzle'
  New-Item -ItemType Directory -Path $rookeryMigrationOutput -Force | Out-Null
  # Copy contents, not the directory into an existing directory of the same name.
  foreach($rookeryItem in Get-ChildItem -LiteralPath $rookeryMigrations){
    Copy-Item -LiteralPath $rookeryItem.FullName -Destination $rookeryMigrationOutput -Recurse -Force
  }
  if(Test-Path -LiteralPath (Join-Path $rookeryMigrationOutput 'drizzle')){throw 'Nested migration directory is invalid.'}
}
tar -C $rookeryStage -czf $rookeryArchive dist
if($LASTEXITCODE -ne 0){throw 'Archive creation failed.'}
$rookeryEntries=tar -tzf $rookeryArchive
if($LASTEXITCODE -ne 0){throw 'Archive inspection failed.'}
if($rookeryEntries -notcontains 'dist/.openai/hosting.json' -or $rookeryEntries -notcontains 'dist/server/index.js'){throw 'Archive is incomplete.'}
if($rookeryEntries -match '(?:^|/)(?:\.private|\.env[^/]*|\.dev\.vars[^/]*|\.git)(?:/|$)|\.dpapi$|drizzle/drizzle/'){throw 'Archive contains a private or nested migration path.'}
foreach($rookerySourceFile in Get-ChildItem -LiteralPath $rookeryMigrations -Recurse -File){
  $rookeryRelative=[IO.Path]::GetRelativePath($rookeryMigrations,$rookerySourceFile.FullName)
  $rookeryStagedFile=Join-Path $rookeryMigrationOutput $rookeryRelative
  if((Get-FileHash -LiteralPath $rookerySourceFile.FullName).Hash -ne (Get-FileHash -LiteralPath $rookeryStagedFile).Hash){throw 'Migration bytes differ.'}
}
[pscustomobject]@{archive=$rookeryArchive;stage=$rookeryStage;entries=$rookeryEntries.Count;sha256=(Get-FileHash -LiteralPath $rookeryArchive).Hash} | ConvertTo-Json

param(
  [string]$SourceDir = "frontend/build/chrome-mv3-prod",
  [string]$OutputDir = "dist",
  [string]$DateStamp = (Get-Date -Format "yyyy-MM-dd"),
  [int]$MaxArchiveMb = 25,
  [switch]$Overwrite
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$src = Resolve-Path $SourceDir -ErrorAction Stop
$manifestPath = Join-Path $src "manifest.json"
if (-not (Test-Path $manifestPath)) {
  throw "Missing manifest.json in $src"
}

$sidepanel = Get-ChildItem -Path $src -Filter "sidepanel*.js" -File
$capsule = Get-ChildItem -Path $src -Filter "capsule-ui*.js" -File
$background = Join-Path $src "static/background/index.js"
$onboardingEntry = Join-Path $src "onboarding.html"
$onboardingPage = Join-Path $src "tabs/onboarding.html"
if (-not $sidepanel) { throw "Missing sidepanel bundle under $src" }
if (-not $capsule) { throw "Missing capsule-ui bundle under $src" }
if (-not (Test-Path $background)) { throw "Missing static/background/index.js under $src" }
if (-not (Test-Path $onboardingEntry)) { throw "Missing onboarding.html under $src" }
if (-not (Test-Path $onboardingPage)) { throw "Missing tabs/onboarding.html under $src" }

$files = Get-ChildItem -Path $src -Recurse -File
$fileCount = ($files | Measure-Object).Count
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$zipPath = Join-Path $OutputDir ("vesti-chrome-mv3-prod-{0}-safe.zip" -f $DateStamp)
if ((Test-Path $zipPath) -and -not $Overwrite) {
  throw "Archive already exists: $zipPath (use -Overwrite to replace)"
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

# Use built-in tar zip path to avoid triggering plasmo package flow.
tar -a -cf $zipPath -C $src .
if ($LASTEXITCODE -ne 0) {
  throw "tar failed while creating $zipPath"
}

if (-not (Test-Path $zipPath)) {
  throw "Archive was not created: $zipPath"
}

$zipInfo = Get-Item $zipPath
if ($zipInfo.Length -le 0) {
  throw "Archive is empty: $zipPath"
}

$maxArchiveBytes = $MaxArchiveMb * 1MB
if ($zipInfo.Length -gt $maxArchiveBytes) {
  throw ("Archive size {0:N2} MB exceeds max budget {1} MB: {2}" -f ($zipInfo.Length / 1MB), $MaxArchiveMb, $zipPath)
}

$manifestSnapshot = Join-Path $OutputDir ("manifest-{0}.json" -f $DateStamp)
Copy-Item -LiteralPath $manifestPath -Destination $manifestSnapshot -Force

$fileListPath = Join-Path $OutputDir ("chrome-mv3-prod-files-{0}.txt" -f $DateStamp)
$files |
  ForEach-Object { $_.FullName.Substring($src.Path.Length + 1) } |
  Set-Content -Path $fileListPath -Encoding UTF8

Write-Host ("Source: {0}" -f $src.Path)
Write-Host ("Files: {0}" -f $fileCount)
Write-Host ("Size: {0:N2} MB" -f ($totalBytes / 1MB))
Write-Host ("Archive: {0}" -f $zipInfo.FullName)
Write-Host ("Archive Size: {0:N2} MB" -f ($zipInfo.Length / 1MB))
Write-Host ("Archive Budget: <= {0} MB" -f $MaxArchiveMb)
Write-Host ("Manifest Snapshot: {0}" -f (Resolve-Path $manifestSnapshot))
Write-Host ("File List: {0}" -f (Resolve-Path $fileListPath))

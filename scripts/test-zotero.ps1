param([string]$ZoteroExe = 'D:\software\zotero\zotero.exe', [switch]$Packaged)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$runDir = Join-Path $taskRoot ('.runtime-test\run-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$profile = Join-Path $runDir 'profile'
$data = Join-Path $runDir 'data'
$extensions = Join-Path $profile 'extensions'
New-Item -ItemType Directory -Path $data, $extensions -Force | Out-Null
$prefs = @{
  'extensions.zotero.dataDir' = $data
  'extensions.zotero.useDataDir' = $true
  'extensions.zotero.autoRecognizeFiles' = $false
  'extensions.zotero.sync.autoSync' = $false
  'extensions.zotero.httpServer.enabled' = $false
  'extensions.zotero.firstRun2' = $false
  'extensions.zotero.metadataSearchTest.output' = (Join-Path $runDir 'report.json')
  'extensions.zotero.metadataSearchTest.pdf' = (Join-Path $taskRoot '.runtime-test\memory-mosaics.pdf')
  'extensions.autoDisableScopes' = 0
  'extensions.enabledScopes' = 15
  'extensions.startupScanScopes' = 15
  'extensions.logging.enabled' = $true
  'app.update.enabled' = $false
  'extensions.update.enabled' = $false
  'browser.shell.checkDefaultBrowser' = $false
}
$lines = $prefs.GetEnumerator() | ForEach-Object { 'user_pref(' + (ConvertTo-Json $_.Key -Compress) + ', ' + (ConvertTo-Json $_.Value -Compress) + ');' }
[IO.File]::WriteAllLines((Join-Path $profile 'user.js'), $lines, [Text.UTF8Encoding]::new($false))
if ($Packaged) {
  $addonVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'addon\manifest.json') -Raw | ConvertFrom-Json).version
  Copy-Item -LiteralPath (Join-Path $taskRoot "dist\paper-metadata-search-$addonVersion.xpi") -Destination (Join-Path $extensions 'paper-metadata-search@local.zotero.xpi')
} else {
  [IO.File]::WriteAllText((Join-Path $extensions 'paper-metadata-search@local.zotero'), (Join-Path $taskRoot 'addon'), [Text.UTF8Encoding]::new($false))
}
[IO.File]::WriteAllText((Join-Path $extensions 'metadata-search-tests@local.zotero'), (Join-Path $taskRoot 'tests\zotero-runner'), [Text.UTF8Encoding]::new($false))
$process = Start-Process -FilePath $ZoteroExe -ArgumentList @('-no-remote', '-profile', ('"' + $profile + '"'), '-ZoteroDebugText') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'stdout.log') -RedirectStandardError (Join-Path $runDir 'stderr.log') -PassThru
Write-Output ('Isolated Zotero PID: ' + $process.Id)
Write-Output ('Report: ' + (Join-Path $runDir 'report.json'))

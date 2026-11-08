param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
& (Join-Path $PSScriptRoot 'build.ps1')
$release = Join-Path $projectRoot ('dist\release-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $release 'payload'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& node.exe (Join-Path $projectRoot 'scripts\release-files.cjs') $stage
if ($LASTEXITCODE -ne 0) { throw 'Pacote bloqueado pela verificação de distribuição.' }
& (Join-Path $PSScriptRoot 'prepare-postgresql.ps1') -Destination (Join-Path $stage 'runtime\postgresql')
$panelDirectory = Join-Path $stage 'dist\windows'
New-Item -ItemType Directory -Force -Path $panelDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\windows\JobTracker.exe') -Destination $panelDirectory
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('dist\windows\' + $name)) -Destination $panelDirectory }
foreach ($name in @('WebView2-LICENSE.txt', 'WebView2-NOTICE.txt')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('dist\windows\' + $name)) -Destination $panelDirectory }
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\windows\JobTracker-Uninstall.exe') -Destination (Join-Path $stage 'Desinstalar Job Tracker.exe')
$postgresDefinition = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'postgresql-runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
@{version = '0.3.6'; databaseEngine = 'native-postgresql'; postgresql = $postgresDefinition.version; architecture = 'x64'; builtAtUtc = [DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'release-info.json') -Encoding UTF8
# A documentação da extensão distribuída é neutra e aponta para o guia local.
[IO.File]::WriteAllText((Join-Path $stage 'chrome-extension\LEIA-ME.md'), "# Job Tracker`n`nConsulte windows/guide.html na instalação para configurar e usar a extensão.`n", (New-Object Text.UTF8Encoding($false)))
$manifest = @()
function Get-Sha256([string]$Path) {
    $input = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($input)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose(); $input.Dispose() }
}
foreach ($file in Get-ChildItem -LiteralPath $stage -File -Recurse) {
    $relative = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $manifest += @{ path = $relative; size = $file.Length; sha256 = (Get-Sha256 $file.FullName) }
}
$manifestPath = Join-Path $release 'release-manifest.json'
ConvertTo-Json -InputObject @($manifest | Sort-Object path) -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $release 'payload.zip'
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    foreach ($record in $manifest) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $stage $record.path), $record.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
$output = $OutputDirectory
if (!$output) { $output = Join-Path $projectRoot 'dist\installer-postgresql' }
$output = [IO.Path]::GetFullPath($output)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$exe = Join-Path $output 'JobTracker-Setup.exe'
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 /utf8output /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/win32manifest:$PSScriptRoot\app.manifest" "/resource:$zipPath,payload.zip" "/resource:$manifestPath,release-manifest.json" "/out:$exe" (Join-Path $PSScriptRoot 'Installer.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o instalador.' }
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $output 'release-manifest.json') -Force
$checksum = Get-Sha256 $exe
[IO.File]::WriteAllText((Join-Path $output 'JobTracker-Setup.exe.sha256'), "$checksum  JobTracker-Setup.exe`n")
Write-Output "Instalador gerado: $exe"
Write-Output "Conteúdo público: $($manifest.Count) arquivos. Relatório e SHA-256 na mesma pasta."

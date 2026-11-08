param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist\chrome' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$source = Join-Path $projectRoot 'chrome-extension'
$manifest = Get-Content (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
    throw 'Manifest da extensão inválido.'
}
# Lista explícita: nunca empacotar perfis, currículos, arquivos .env ou dados locais.
$files = @('manifest.json', 'app-bridge.js', 'application-tabs.js', 'background.js',
    'fill.js', 'navigation.js', 'popup.css', 'popup.html', 'popup.js', 'presentation.js', 'LEIA-ME.md')
foreach ($file in $files) {
    if (!(Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) { throw "Arquivo ausente: $file" }
}
$folder = Join-Path $OutputDirectory ("job-tracker-chrome-" + $manifest.version)
New-Item -ItemType Directory -Force -Path $folder | Out-Null
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $folder $file) -Force }
$instructions = @"
Job Tracker - extensão Chrome $($manifest.version)

1. Abra chrome://extensions no perfil que você usa para se candidatar.
2. Ative o Modo do desenvolvedor.
3. Clique em Carregar sem compactação e selecione a pasta:
$folder
4. Abra o Job Tracker pelo atalho do programa e use Preencher formulário.

Se a extensão já estiver instalada nesta pasta, clique em Recarregar.
Se estiver instalada em outra pasta, remova a antiga antes de carregar esta.
O ZIP serve para transporte: extraia antes de carregar no Chrome.
Mantenha a pasta no disco enquanto a extensão estiver instalada.
"@
[IO.File]::WriteAllText((Join-Path $folder 'INSTALAR.txt'), $instructions, [Text.Encoding]::UTF8)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $OutputDirectory ("job-tracker-chrome-" + $manifest.version + '.zip')
# Criar um arquivo temporário e trocar somente após finalizar a compactação.
$temporaryZip = Join-Path $OutputDirectory ([Guid]::NewGuid().ToString() + '.zip')
try {
    $archive = [IO.Compression.ZipFile]::Open($temporaryZip, 'Create')
    try {
        foreach ($file in ($files + 'INSTALAR.txt')) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $folder $file), $file) | Out-Null
        }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $temporaryZip -Destination $zip -Force
} finally {
    if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip }
}
Write-Output "Extensão $($manifest.version) gerada."
Write-Output "Pasta para carregar no Chrome: $folder"
Write-Output "ZIP: $zip"

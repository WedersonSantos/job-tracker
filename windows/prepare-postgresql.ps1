param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$definition = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'postgresql-runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($definition.archiveUrl -notmatch '^https://get\.enterprisedb\.com/postgresql/postgresql-[0-9.-]+-windows-x64-binaries\.zip$' -or $definition.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Definição do runtime PostgreSQL inválida.' }
$cache = Join-Path $projectRoot 'tmp\postgres-vendor'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$archivePath = Join-Path $cache ([IO.Path]::GetFileName($definition.archiveUrl))
if (!(Test-Path -LiteralPath $archivePath)) {
    Write-Output 'Baixando binários PostgreSQL da EDB para preparar o instalador...'
    $temporary = $archivePath + '.partial'
    $client = New-Object Net.WebClient
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $client.DownloadFile($definition.archiveUrl, $temporary); Move-Item -LiteralPath $temporary -Destination $archivePath -Force }
    finally { $client.Dispose() }
}
$stream = [IO.File]::OpenRead($archivePath)
$hash = [Security.Cryptography.SHA256]::Create()
try { $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $hash.Dispose() }
if ($digest -ne $definition.sha256) { throw 'Hash do arquivo PostgreSQL divergente. O runtime não será incluído no instalador.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
$count = 0
try {
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        $include = $name -match '^pgsql/bin/[^/]+\.(exe|dll)$' -or $name -match '^pgsql/lib/.*\.dll$' -or $name -match '^pgsql/share/' -or $name -match '^pgsql/(COPYRIGHT|LICENSE|server_license\.txt|commandlinetools_3rd_party_licenses\.txt)$' -or $name -eq 'pgsql/doc/postgresql/html/legalnotice.html'
        if (!$include -or !$entry.Name) { continue }
        $relative = $name.Substring('pgsql/'.Length).Replace('/', '\')
        $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
        if (!$target.StartsWith($destinationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho inválido no arquivo PostgreSQL.' }
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        $count++
    }
} finally { $zip.Dispose() }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'postgresql-runtime.json') -Destination (Join-Path $destinationRoot 'origin.json') -Force
Write-Output "PostgreSQL $($definition.version) x64: $count arquivos de runtime incluídos; nenhum banco de dados copiado."

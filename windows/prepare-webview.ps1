param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$version = '1.0.4314.35'
$expected = '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4'
$cache = Join-Path $projectRoot 'tmp\webview-vendor'
New-Item -ItemType Directory -Force -Path $cache, $Destination | Out-Null
$package = Join-Path $cache "webview2.$version.nupkg"
if (!(Test-Path -LiteralPath $package)) {
    $client = New-Object Net.WebClient
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $client.DownloadFile("https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg", $package) }
    finally { $client.Dispose() }
}
$stream = [IO.File]::OpenRead($package); $hash = [Security.Cryptography.SHA256]::Create()
try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose(); $hash.Dispose() }
if ($actual -ne $expected) { throw 'Hash do SDK WebView2 divergente. Compilação interrompida.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($package)
try {
    foreach ($name in @('lib/net462/Microsoft.Web.WebView2.Core.dll', 'lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'build/native/x64/WebView2Loader.dll')) {
        $entry = $zip.GetEntry($name)
        if (!$entry) { throw 'SDK WebView2 incompleto.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Destination $entry.Name), $true)
    }
    foreach ($entry in $zip.Entries | Where-Object { $_.FullName -match '(?i)^[^/]*(license|notice)[^/]*$' }) {
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Destination ('WebView2-' + $entry.Name)), $true)
    }
} finally { $zip.Dispose() }
Write-Output "SDK WebView2 $version x64 verificado e preparado."

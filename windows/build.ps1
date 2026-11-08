$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (!(Test-Path -LiteralPath $compiler)) { throw 'Instale o .NET Framework 4.8 do Windows para gerar o painel.' }
$output = Join-Path $projectRoot 'dist\windows'
New-Item -ItemType Directory -Force -Path $output | Out-Null
& (Join-Path $PSScriptRoot 'prepare-webview.ps1') -Destination $output
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64,64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$font = New-Object Drawing.Font('Segoe UI', 27, [Drawing.FontStyle]::Bold)
$iconStream = [IO.File]::Create((Join-Path $output 'jobtracker.ico'))
try {
    $graphics.Clear([Drawing.Color]::FromArgb(24,24,27))
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.DrawString('JT', $font, [Drawing.Brushes]::White, 3, 7)
    $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
    try { $icon.Save($iconStream) } finally { $icon.Dispose() }
} finally { $iconStream.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /utf8output /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.Http.dll /r:System.Security.dll "/r:$output\Microsoft.Web.WebView2.Core.dll" "/r:$output\Microsoft.Web.WebView2.WinForms.dll" "/win32icon:$output\jobtracker.ico" "/win32manifest:$PSScriptRoot\app.manifest" "/out:$output\JobTracker.exe" (Join-Path $PSScriptRoot 'JobTracker.cs')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível compilar o painel Windows.' }
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 /utf8output /r:System.Windows.Forms.dll /r:System.Drawing.dll "/win32manifest:$PSScriptRoot\app.manifest" "/out:$output\JobTracker-Uninstall.exe" (Join-Path $PSScriptRoot 'Uninstaller.cs')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível compilar o desinstalador Windows.' }
& (Join-Path $projectRoot 'scripts\build-extension.ps1')
Write-Output "Painel Windows gerado: $output\JobTracker.exe"

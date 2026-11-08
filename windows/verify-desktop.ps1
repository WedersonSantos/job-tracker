$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$testBase = if ($env:JOBTRACKER_TEST_ROOT) { $env:JOBTRACKER_TEST_ROOT } else { Join-Path $projectRoot 'tmp' }
$fixture = Join-Path $testBase ('desktop-check-' + [Guid]::NewGuid().ToString('N'))
$windows = Join-Path $fixture 'windows'
New-Item -ItemType Directory -Force -Path $windows, (Join-Path $fixture 'node_modules\next') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'services.ps1') -Destination $windows
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'guide.html') -Destination $windows
'{}' | Set-Content -LiteralPath (Join-Path $fixture 'node_modules\next\package.json')
@{id = ('a' * 32); database = @{engine = 'native-postgresql'}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'installation.json')
$stub = @'
param([string]$Action, [string]$InstallRoot)
if ($Action -eq 'start') {
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'native-starting'), 'started')
    Start-Sleep -Seconds 3
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'native-ready'), 'ready')
} else { [IO.File]::WriteAllText((Join-Path $InstallRoot 'native-stopped'), 'stopped') }
'@
[IO.File]::WriteAllText((Join-Path $windows 'native-postgres.ps1'), $stub, (New-Object Text.UTF8Encoding($true)))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$binaries = Join-Path $projectRoot 'dist\windows'
foreach ($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) { Copy-Item -LiteralPath (Join-Path $binaries $name) -Destination $fixture }
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /main:DesktopTests /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.Http.dll /r:System.Security.dll "/r:$fixture\Microsoft.Web.WebView2.Core.dll" "/r:$fixture\Microsoft.Web.WebView2.WinForms.dll" "/out:$fixture\desktop-tests.exe" (Join-Path $PSScriptRoot 'JobTracker.cs') (Join-Path $PSScriptRoot 'desktop-tests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar teste da janela integrada.' }
$listeners = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -in @(3000,3333) })
if ($listeners.Count) {
    # Não parar o aplicativo que o usuário pediu para manter aberto.
    $isolatedServices = @'
param([string]$Action)
$root = Split-Path $PSScriptRoot -Parent
if ($Action -eq 'cancel') { [IO.File]::WriteAllText((Join-Path $root 'cancel-request'), 'stop'); exit 0 }
if ($Action -eq 'stop') { [IO.File]::WriteAllText((Join-Path $root 'native-stopped'), 'stopped'); exit 0 }
[IO.File]::WriteAllText((Join-Path $root 'native-starting'), 'starting')
Start-Sleep -Seconds 3
[IO.File]::WriteAllText((Join-Path $root 'native-ready'), 'ready')
if (Test-Path -LiteralPath (Join-Path $root 'cancel-request')) { exit 2 }
exit 0
'@
    [IO.File]::WriteAllText((Join-Path $windows 'services.ps1'), $isolatedServices, (New-Object Text.UTF8Encoding($true)))
    Write-Output 'Serviços atuais preservados; cancelamento da janela testado com inicialização simulada.'
}
    $process = Start-Process -FilePath (Join-Path $fixture 'desktop-tests.exe') -ArgumentList "cancel `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'O botão não cancelou a inicialização.' }
    if (!(Test-Path -LiteralPath (Join-Path $fixture 'native-ready'))) { throw 'O inicializador foi encerrado antes de concluir sua etapa segura.' }
    if (Test-Path -LiteralPath (Join-Path $fixture 'dist\windows\runtime\startup.json')) { throw 'Estado de inicialização não foi limpo.' }
    Write-Output 'OK: clique real no botão habilitado durante inicialização, cancelamento cooperativo e parada dos serviços.'
$browserStub = @'
param([string]$Action)
if ($Action -eq 'stop') { [IO.File]::WriteAllText((Join-Path $PSScriptRoot '..\services-stopped'), 'stopped'); exit 0 }
if ($Action -eq 'start' -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '..\fail-start'))) { exit 1 }
if ($Action -eq 'start') {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $PSScriptRoot '..\desktop-tests.exe'
    $info.Arguments = 'hold-pipe'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    [Diagnostics.Process]::Start($info) | Out-Null
}
exit 0
'@
[IO.File]::WriteAllText((Join-Path $windows 'services.ps1'), $browserStub, (New-Object Text.UTF8Encoding($true)))
$process = Start-Process -FilePath (Join-Path $fixture 'desktop-tests.exe') -ArgumentList "stop `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Parar serviços não fechou a janela ou abriu o aplicativo novamente.' }
Write-Output 'OK: Parar serviços aguarda a parada confirmada, fecha o painel e não abre outra janela ou navegador.'
$process = Start-Process -FilePath (Join-Path $fixture 'desktop-tests.exe') -ArgumentList "browser `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'A abertura no navegador não respeitou o sucesso da inicialização.' }
Write-Output 'OK: navegador acionado sem aguardar o filho que mantém pipes abertos; falha e cancelamento não abrem; registros visíveis desde o início.'
$process = Start-Process -FilePath (Join-Path $fixture 'desktop-tests.exe') -ArgumentList "preview `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Falha ao renderizar as prévias do painel.' }
Write-Output "Prévias do painel: $fixture"
$process = Start-Process -FilePath (Join-Path $fixture 'desktop-tests.exe') -ArgumentList "embed `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'A interface WebView2 não carregou dentro do aplicativo. Confira desktop-test-result.txt na pasta do teste.' }
Write-Output 'OK: WebView2 real carregou o guia na janela, mantém rotas locais dentro do aplicativo e distingue links externos.'
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /main:UninstallerTests /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$fixture\uninstaller-tests.exe" (Join-Path $PSScriptRoot 'Uninstaller.cs') (Join-Path $PSScriptRoot 'uninstaller-tests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar teste do desinstalador.' }
$uninstallStub = @'
param([string]$InstallRoot, [string]$CompletionFile)
[IO.File]::WriteAllText((Join-Path $InstallRoot 'uninstall-stub-complete'), 'complete')
if (!(Test-Path -LiteralPath (Join-Path $InstallRoot 'missing-confirmation'))) { [IO.File]::WriteAllText($CompletionFile, 'JOBTRACKER_UNINSTALL_COMPLETE') }
'@
[IO.File]::WriteAllText((Join-Path $windows 'uninstall.ps1'), $uninstallStub, (New-Object Text.UTF8Encoding($true)))
$process = Start-Process -FilePath (Join-Path $fixture 'uninstaller-tests.exe') -ArgumentList "`"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'O desinstalador não fechou após sucesso.' }
Write-Output 'OK: clique no desinstalador executou a operação e fechou a janela automaticamente após sucesso.'
[IO.File]::WriteAllText((Join-Path $fixture 'missing-confirmation'), 'test')
$process = Start-Process -FilePath (Join-Path $fixture 'uninstaller-tests.exe') -ArgumentList "`"$fixture`" unconfirmed" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'O desinstalador fechou sem confirmação da conferência final.' }
Write-Output 'OK: saída zero sem confirmação de limpeza mantém a janela aberta para exibir a falha.'
. (Join-Path $PSScriptRoot 'shortcuts.ps1')
$sandboxDesktop = Join-Path $fixture 'shortcut-desktop'
$sandboxMenu = Join-Path $fixture 'shortcut-menu'
New-JobTrackerShortcuts -Root $fixture -Desktop $sandboxDesktop -Menu $sandboxMenu -SkipRegistration
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $sandboxDesktop 'Job Tracker.lnk'))
if ($link.TargetPath -ne (Join-Path $fixture 'dist\windows\JobTracker.exe') -or $link.Arguments -ne '') { throw 'O atalho não abre diretamente o programa.' }
Write-Output 'OK: atalho .lnk real aponta para o programa, com diretório de trabalho e ícone, sem abrir navegador.'

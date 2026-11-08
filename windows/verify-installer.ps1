$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $projectRoot 'dist\installer-postgresql\JobTracker-Setup.exe'
if ($env:JOBTRACKER_TEST_INSTALLER) { $installer = $env:JOBTRACKER_TEST_INSTALLER }
if (!(Test-Path -LiteralPath $installer)) { throw 'Gere o instalador com npm run build:installer antes de verificar.' }
$fixture = Join-Path $projectRoot ('tmp\installer-check-' + [Guid]::NewGuid().ToString('N'))
if ($env:JOBTRACKER_TEST_ROOT) { $fixture = Join-Path $env:JOBTRACKER_TEST_ROOT ('installer-check-' + [Guid]::NewGuid().ToString('N')) }
$process = Start-Process -FilePath $installer -ArgumentList "--verify-to `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'A extração ou a validação do pacote falhou.' }
Write-Output 'OK: executável validou e extraiu seu próprio pacote, com hashes conferidos.'
$release = Get-Content -LiteralPath (Join-Path $fixture 'release-info.json') -Raw | ConvertFrom-Json
if ($release.version -ne '0.3.6' -or $release.databaseEngine -ne 'native-postgresql' -or $release.postgresql -ne '16.15') { throw 'Metadados de versão do instalador estão desatualizados.' }
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($installer).FileVersion -ne '0.3.6.0') { throw 'Versão do executável está desatualizada.' }
Write-Output 'OK: instalador 0.3.6 com PostgreSQL privado 16.15 confirmado no executável e no pacote.'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /codepage:65001 /main:InstallerUiTests /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/out:$fixture\installer-ui-tests.exe" (Join-Path $PSScriptRoot 'Installer.cs') (Join-Path $PSScriptRoot 'installer-ui-tests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes do instalador.' }
$process = Start-Process -FilePath (Join-Path $fixture 'installer-ui-tests.exe') -ArgumentList "`"$fixture`"" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Falha nos estados e progresso do instalador. Confira $fixture\installer-ui-result.txt" }
Write-Output "OK: janela compacta, controles ocultos durante instalação, detalhes de erro e fechamento automático. Prévias: $fixture"
$status = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'windows\prerequisites.ps1') -StatusOnly
if ($LASTEXITCODE -ne 0) { throw 'A detecção de requisitos falhou.' }
$requirements = ($status -join "`n") | ConvertFrom-Json
if ($null -eq $requirements.nodeReady -or $null -eq $requirements.webviewReady -or $null -eq $requirements.vcReady) { throw 'A detecção não forneceu o estado dos requisitos.' }
Write-Output 'OK: consulta real dos requisitos é somente leitura e retorna estado estruturado.'
$setupAssembly = [Reflection.Assembly]::LoadFile([IO.Path]::GetFullPath($installer))
Add-Type -TypeDefinition @'
using System;
using System.Reflection;
public static class JobTrackerSetupFolderTest {
    public static bool Check(Assembly assembly, string path) {
        return (bool)assembly.GetType("SetupForm").GetMethod("ContainsFilesOrLinks", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] {path});
    }
}
'@
$emptyTree = Join-Path $fixture 'empty-folder-check'
New-Item -ItemType Directory -Path (Join-Path $emptyTree 'pastas\vazias') | Out-Null
if ([JobTrackerSetupFolderTest]::Check($setupAssembly, [string]$emptyTree)) { throw 'O instalador recusaria pastas vazias restantes de uma versão antiga.' }
[IO.File]::WriteAllText((Join-Path $emptyTree 'user-file.txt'), 'synthetic')
if (![JobTrackerSetupFolderTest]::Check($setupAssembly, [string]$emptyTree)) { throw 'O instalador adotaria uma pasta com arquivos de outra origem.' }
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    if (!(Test-Path -LiteralPath (Join-Path $fixture ('dist\windows\' + $name)))) { throw 'A janela integrada está incompleta no instalador.' }
}
foreach ($private in @('.env', 'installation.json', 'recruiter-backend\.env', 'recruiter-frontend\.env.local', 'data', 'node_modules', 'dist\windows\runtime')) {
    if (Test-Path -LiteralPath (Join-Path $fixture $private)) { throw "Estado privado veio no pacote: $private" }
}
Write-Output 'OK: pacote extraído não contém configurações nem dados de usuário.'
$script = Join-Path $fixture 'windows\initialize.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -SkipDependencies -SkipShortcuts
if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar a cópia isolada.' }
$identity = Get-Content (Join-Path $fixture 'installation.json') -Raw | ConvertFrom-Json
$config = [IO.File]::ReadAllText((Join-Path $fixture 'recruiter-backend\.env'))
if ($config -notmatch '(?m)^ANTHROPIC_API_KEY=\r?$' -or $config -notmatch [regex]::Escape("127.0.0.1:$($identity.database.port)/recruit") -or $config -notmatch 'recruit:[a-f0-9]{64}@' -or $identity.database.engine -ne 'native-postgresql') { throw 'Configuração nova não está vazia ou isolada.' }
$rootConfig = [IO.File]::ReadAllText((Join-Path $fixture '.env'))
if ($rootConfig -notmatch 'JOBTRACKER_DB_ENGINE=native-postgresql') { throw 'Banco sem identificação isolada.' }
foreach ($required in @('postgres.exe', 'pg_ctl.exe', 'initdb.exe', 'psql.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $fixture ('runtime\postgresql\bin\' + $required)))) { throw "Runtime privado ausente: $required" }
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -SkipDependencies -SkipShortcuts
if ($LASTEXITCODE -ne 0) { throw 'Falha ao repetir a preparação.' }
if ($config -cne [IO.File]::ReadAllText((Join-Path $fixture 'recruiter-backend\.env'))) { throw 'Configuração foi substituída na repetição.' }
if ($rootConfig -cne [IO.File]::ReadAllText((Join-Path $fixture '.env'))) { throw 'Credenciais foram substituídas na repetição.' }
$generated = Get-ChildItem -LiteralPath (Join-Path $fixture 'dist\chrome') -Filter 'job-tracker-chrome-*' -Directory | Select-Object -First 1
$instructions = [IO.File]::ReadAllText((Join-Path $generated.FullName 'INSTALAR.txt'))
if (!$instructions.Contains($fixture) -or $instructions.Contains((Join-Path $projectRoot 'dist\chrome'))) { throw 'A extensão contém caminho de outra instalação.' }
Write-Output 'OK: credenciais novas, IA vazia, extensão gerada no destino e configurações preservadas.'
if (@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq 3333).Count -gt 0) {
    # Apenas satisfazer a checagem de dependências; o comando deve parar antes de executar npm ou consultar perfis.
    $fakeDependencies = Join-Path $fixture 'node_modules\next'
    New-Item -ItemType Directory -Force -Path $fakeDependencies | Out-Null
    '{}' | Set-Content -LiteralPath (Join-Path $fakeDependencies 'package.json')
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'windows\services.ps1') -Action start
    if ($LASTEXITCODE -ne 1 -or ($result -join "`n") -notmatch 'Outra instalação está usando a porta 3333') { throw 'A instalação tentou adotar outro servidor local.' }
    Write-Output 'OK: uma instalação nova recusa o servidor de outra instalação, antes de consultar perfis.'
}
# A proteção é testada com um valor sintético, nunca com uma chave real.
Add-Type -AssemblyName System.Security
$testBytes = [Text.Encoding]::UTF8.GetBytes('synthetic-test-value')
$cipher = [Security.Cryptography.ProtectedData]::Protect($testBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
if ([Text.Encoding]::UTF8.GetString($plain) -ne 'synthetic-test-value') { throw 'Falha no armazenamento protegido.' }
Write-Output 'OK: proteção DPAPI e leitura para o usuário Windows atual.'
$fakeBin = Join-Path $fixture 'fake-bin'
New-Item -ItemType Directory -Path $fakeBin | Out-Null
@'
@echo off
if "%1"=="ci" if exist "%~dp0fail-ci" exit /b 1
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'npm.cmd') -Encoding ASCII
$prerequisitesFile = Join-Path $fixture 'windows\prerequisites.ps1'
$prerequisitesBytes = [IO.File]::ReadAllBytes($prerequisitesFile)
$savedPath = $env:Path
try {
    # Somente a cópia isolada: nenhum WinGet ou download npm real pode ser executado.
    [IO.File]::WriteAllText($prerequisitesFile, "param([switch]`$InstallMissing)`r`nif (!`$InstallMissing) { throw 'Preparação automática ausente.' }`r`n", (New-Object Text.UTF8Encoding($true)))
    $env:Path = $fakeBin + ';' + $savedPath
    $messages = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -InstallPrerequisites -SkipShortcuts)
    if ($LASTEXITCODE -ne 0) { throw 'O fluxo de etapas simuladas falhou.' }
    $updates = @($messages | Where-Object { $_ -like 'JOBTRACKER_PROGRESS:*' } | ForEach-Object { $_.Substring('JOBTRACKER_PROGRESS:'.Length) | ConvertFrom-Json })
    if (($updates.completed -join ',') -ne '2,2,3,4,5,6,6') { throw 'Etapas não correspondem às tarefas concluídas.' }
    [IO.File]::WriteAllText((Join-Path $fakeBin 'fail-ci'), 'synthetic')
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $messages = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -InstallPrerequisites -SkipShortcuts 2>$null)
        $failureCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($failureCode -eq 0) { throw 'Falha npm foi aceita como sucesso.' }
    $updates = @($messages | Where-Object { $_ -like 'JOBTRACKER_PROGRESS:*' } | ForEach-Object { $_.Substring('JOBTRACKER_PROGRESS:'.Length) | ConvertFrom-Json })
    if (@($updates | Where-Object completed -gt 3).Count) { throw 'O progresso avançou após o download falhar.' }
} finally { $env:Path = $savedPath; [IO.File]::WriteAllBytes($prerequisitesFile, $prerequisitesBytes) }
Write-Output 'OK: etapas completas e falha no npm simuladas, sem download real; falha não avança nem indica conclusão.'
Write-Output 'Este teste não instala dependências, não cria atalhos e não inicia nem copia banco de dados.'

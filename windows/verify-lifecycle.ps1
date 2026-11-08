$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'prerequisites.ps1') -DefinitionsOnly
$script:packages = @()
$script:state = @{nodeReady = $false; vcReady = $false; webviewReady = $false; wingetReady = $true}
function Update-JobTrackerPath { }
function Get-JobTrackerRequirements { return $script:state }
function Invoke-JobTrackerPackage([string]$Id) {
    $script:packages += $Id
    if ($Id -eq 'OpenJS.NodeJS.LTS') { $script:state.nodeReady = $true }
    if ($Id -eq 'Microsoft.VCRedist.2015+.x64') { $script:state.vcReady = $true }
    if ($Id -eq 'Microsoft.EdgeWebView2Runtime') { $script:state.webviewReady = $true }
}
$rejected = $false
try { Ensure-JobTrackerRequirements } catch { $rejected = $true }
if (!$rejected -or $packages.Count -ne 0) { throw 'Requisitos foram instalados sem autorização.' }
Ensure-JobTrackerRequirements -AllowInstall
if (($packages -join ',') -ne 'OpenJS.NodeJS.LTS,Microsoft.VCRedist.2015+.x64,Microsoft.EdgeWebView2Runtime') { throw 'Plano de instalação inesperado.' }
Ensure-JobTrackerRequirements -AllowInstall
if ($packages.Count -ne 3) { throw 'Requisitos existentes foram reinstalados.' }
$script:packages = @()
$script:state = @{nodeReady = $true; vcReady = $false; webviewReady = $true; wingetReady = $true}
Ensure-JobTrackerRequirements -AllowInstall
if (($packages -join ',') -ne 'Microsoft.VCRedist.2015+.x64') { throw 'Um requisito presente seria baixado novamente.' }
$script:state = @{nodeReady = $true; vcReady = $false; webviewReady = $true; wingetReady = $false}
$rejected = $false
try { Ensure-JobTrackerRequirements -AllowInstall } catch { $rejected = $_.Exception.Message -match 'WinGet' }
if (!$rejected) { throw 'A ausência do WinGet não foi tratada.' }
Write-Output 'OK: requisitos ausentes, existentes, sem autorização e sem WinGet; nenhuma instalação real foi executada.'

. (Join-Path $PSScriptRoot 'uninstall.ps1') -DefinitionsOnly
$databaseImplementation = (Get-Item Function:Stop-JobTrackerDatabase).ScriptBlock
$script:dockerCalls = @()
$script:expectedProject = 'jobtracker-' + ('a' * 32)
function docker.exe {
    $script:dockerCalls += ,@($args)
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'info') { return 'test-version' }
    if ($args[0] -eq 'ps') { return '111111111111' }
    if ($args[0] -eq 'network' -and $args[1] -eq 'ls') { return '222222222222' }
    if ($args[0] -eq 'volume' -and $args[1] -eq 'ls') { return @(($script:expectedProject + '_postgres-data'), 'other-installation_postgres-data') }
}
& $databaseImplementation $expectedProject $false
if (@($dockerCalls | Where-Object { $_[0] -eq 'volume' -and $_[1] -eq 'rm' }).Count -ne 0) { throw 'Banco seria excluído sem a opção de apagar dados.' }
$script:dockerCalls = @()
& $databaseImplementation $expectedProject $true
$removedVolumes = @($dockerCalls | Where-Object { $_[0] -eq 'volume' -and $_[1] -eq 'rm' })
if ($removedVolumes.Count -ne 1 -or $removedVolumes[0][2] -ne ($expectedProject + '_postgres-data')) { throw 'Exclusão não ficou restrita ao volume da instalação.' }
Remove-Item Function:docker.exe
Write-Output 'OK: comandos Docker simulados preservam dados por padrão e excluem apenas o volume exato ao solicitar exclusão.'
$script:databaseCalls = @()
function Stop-JobTrackerDatabase([string]$Project, [bool]$EraseData) {
    $script:databaseCalls += @{project = $Project; erase = $EraseData}
}
$installer = Join-Path $projectRoot 'dist\installer-postgresql\JobTracker-Setup.exe'
if ($env:JOBTRACKER_TEST_INSTALLER) { $installer = $env:JOBTRACKER_TEST_INSTALLER }
$testBase = Join-Path $projectRoot ('tmp\lifecycle-' + [Guid]::NewGuid().ToString('N'))
if ($env:JOBTRACKER_TEST_ROOT) { $testBase = Join-Path $env:JOBTRACKER_TEST_ROOT ('lifecycle-' + [Guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Path $testBase | Out-Null
$outside = Join-Path $testBase 'fora da instalação'
New-Item -ItemType Directory -Path $outside | Out-Null
$canary = Join-Path $outside 'preservar.txt'
[IO.File]::WriteAllText($canary, 'arquivo externo de teste')
$retryRoot = Join-Path $testBase 'retry-check'
New-Item -ItemType Directory -Path $retryRoot | Out-Null
$lockedFile = Join-Path $retryRoot 'locked.dat'
[IO.File]::WriteAllText($lockedFile, 'synthetic')
$retryPlan = @{root = $retryRoot; trees = @(); files = @($lockedFile)}
$held = [IO.File]::Open($lockedFile, 'Open', 'ReadWrite', 'None')
try {
    $blocked = $false
    try { Remove-JobTrackerFiles $retryPlan -TimeoutSeconds 0 } catch { $blocked = $_.Exception.Message -match 'incompleta' }
    if (!$blocked -or !(Test-Path -LiteralPath $lockedFile)) { throw 'Arquivo bloqueado foi declarado removido.' }
} finally { $held.Dispose() }
Add-Type -TypeDefinition 'public static class JobTrackerReleaseTest { public static void ReleaseLater(System.IO.FileStream file) { System.Threading.Tasks.Task.Run(() => { System.Threading.Thread.Sleep(900); file.Dispose(); }); } }'
$held = [IO.File]::Open($lockedFile, 'Open', 'ReadWrite', 'None')
[JobTrackerReleaseTest]::ReleaseLater($held)
try { Remove-JobTrackerFiles $retryPlan -TimeoutSeconds 5 } finally { $held.Dispose() }
if (Test-Path -LiteralPath $lockedFile) { throw 'A conferência não aguardou a liberação do arquivo.' }
Write-Output 'OK: bloqueio persistente impede sucesso; arquivo liberado durante a conferência é removido antes da conclusão.'
foreach ($erase in @($false, $true)) {
    $fixture = Join-Path $testBase ("pasta escolhida ç " + $erase)
    $process = Start-Process -FilePath $installer -ArgumentList "--verify-to `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'Falha ao extrair no caminho escolhido.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'windows\initialize.ps1') -SkipDependencies -SkipShortcuts
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar instalação isolada.' }
    $identity = Get-Content (Join-Path $fixture 'installation.json') -Raw | ConvertFrom-Json
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'data'), (Join-Path $fixture 'dist\windows\runtime'), (Join-Path $fixture 'node_modules') | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'data\curriculo-de-teste.txt'), 'dados sintéticos')
    [IO.File]::WriteAllText((Join-Path $fixture 'dist\windows\runtime\anthropic.key'), 'proteção sintética para teste de remoção')
    [IO.File]::WriteAllText((Join-Path $fixture 'arquivo-do-usuario.txt'), 'arquivo desconhecido deve permanecer')
    New-Item -ItemType Junction -Path (Join-Path $fixture 'node_modules\link-externo') -Target $outside | Out-Null
    # Uma entrada fora da pasta precisa ser rejeitada antes da primeira remoção.
    $manifestPath = Join-Path $fixture 'windows\installed-files.json'
    $original = [IO.File]::ReadAllText($manifestPath)
    '[{"path":"../fora da instalação/preservar.txt"}]' | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $rejected = $false
    try { Get-JobTrackerUninstallPlan $fixture $erase | Out-Null } catch { $rejected = $true }
    if (!$rejected -or !(Test-Path -LiteralPath $canary)) { throw 'Caminho externo não foi bloqueado.' }
    [IO.File]::WriteAllText($manifestPath, $original, (New-Object Text.UTF8Encoding($false)))
    Invoke-JobTrackerUninstall $fixture $erase
    if (Test-Path -LiteralPath (Join-Path $fixture 'dist\windows\JobTracker.exe')) { throw 'Executável do programa não foi removido.' }
    if (!(Test-Path -LiteralPath (Join-Path $fixture 'arquivo-do-usuario.txt'))) { throw 'Arquivo desconhecido foi removido.' }
    if (!(Test-Path -LiteralPath $canary)) { throw 'A remoção atravessou uma junção.' }
    $emptyFolders = @(Get-ChildItem -LiteralPath $fixture -Directory -Recurse | Where-Object { [IO.Directory]::GetFileSystemEntries($_.FullName).Length -eq 0 })
    if ($emptyFolders.Count) { throw 'A desinstalação deixou pastas vazias do programa.' }
    if ((Test-Path -LiteralPath (Join-Path $fixture 'data\curriculo-de-teste.txt')) -eq $erase) { throw 'A opção de preservar dados não foi respeitada.' }
    if ((Test-Path -LiteralPath (Join-Path $fixture '.env')) -eq $erase) { throw 'A opção de preservar configurações não foi respeitada.' }
    if ((Test-Path -LiteralPath (Join-Path $fixture 'dist\windows\runtime\anthropic.key')) -eq $erase) { throw 'A opção de preservar a chave não foi respeitada.' }
    $lastCall = $databaseCalls[-1]
    if ($null -ne $lastCall) { throw 'Uma instalação nativa tentou acessar o banco Docker legado.' }
    Write-Output "OK: pasta personalizada, desinstalação com excluir dados = $erase, arquivos externos e desconhecidos preservados."
}
Write-Output 'Os testes usaram apenas dados sintéticos e não removeram contêineres, volumes ou requisitos reais.'

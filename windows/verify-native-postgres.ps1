$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $projectRoot 'dist\installer-postgresql\JobTracker-Setup.exe'
if ($env:JOBTRACKER_TEST_INSTALLER) { $installer = $env:JOBTRACKER_TEST_INSTALLER }
$fixture = Join-Path $projectRoot ('tmp\postgres-real-' + [Guid]::NewGuid().ToString('N') + '\pasta com espaço e ç')
if ($env:JOBTRACKER_TEST_ROOT) { $fixture = Join-Path $env:JOBTRACKER_TEST_ROOT ('postgres-real-' + [Guid]::NewGuid().ToString('N') + '\pasta com espaço e ç') }
function Expand-TestInstallation {
    $setup = Start-Process -FilePath $installer -ArgumentList "--verify-to `"$fixture`"" -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw 'O instalador não conseguiu extrair o runtime privado.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'windows\initialize.ps1') -SkipDependencies -SkipShortcuts
    if ($LASTEXITCODE -ne 0) { throw 'Falha na configuração isolada.' }
}
Expand-TestInstallation
. (Join-Path $fixture 'windows\native-postgres.ps1') -DefinitionsOnly
$configuration = Get-JobTrackerPostgres $fixture
$nativeRoot = Split-Path (Split-Path (Split-Path $configuration.bin -Parent) -Parent) -Parent
$resolvedRoot = Get-JobTrackerNativePath $nativeRoot -Long
if (!$resolvedRoot.TrimEnd('\').Equals([IO.Path]::GetFullPath($fixture).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'O alias do banco aponta para outra instalação.' }
$apiProcess = $null
function Invoke-TestSql([string]$Query) {
    $result = Invoke-JobTrackerPostgresCommand (Join-Path $configuration.bin 'psql.exe') @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$configuration.port, '-U', 'recruit', '-d', 'recruit', '-At', '-v', 'ON_ERROR_STOP=1', '-c', $Query) $configuration
    if ($result.code -ne 0) { throw 'Falha no SQL do banco sintético de teste.' }
    return $result.output
}
try {
    Start-JobTrackerPostgres $fixture
    if (!(Test-JobTrackerPostgresProcess $configuration)) { throw 'Identificação do processo privado falhou.' }
    if ((Invoke-TestSql "SHOW listen_addresses") -ne '127.0.0.1') { throw 'Banco exposto fora do loopback.' }
    $wrong = $configuration.Clone(); $wrong.password = '0' * 64
    $rejected = Invoke-JobTrackerPostgresCommand (Join-Path $configuration.bin 'psql.exe') @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$configuration.port, '-U', 'recruit', '-d', 'recruit', '-c', 'SELECT 1') $wrong
    if ($rejected.code -eq 0) { throw 'O banco aceitou uma senha incorreta.' }
    # Aplicar migrations antes de criar a tabela sintética, pois Prisma exige
    # um schema vazio na primeira implantação.
    $previousDatabaseUrl = $env:DATABASE_URL
    try {
        $env:DATABASE_URL = "postgresql://recruit:$($configuration.password)@127.0.0.1:$($configuration.port)/recruit"
        Push-Location -LiteralPath $projectRoot
        try { & npm.cmd run db:deploy; if ($LASTEXITCODE -ne 0) { throw 'Migrations falharam no banco nativo.' } }
        finally { Pop-Location }
    } finally { $env:DATABASE_URL = $previousDatabaseUrl }
    Invoke-TestSql "CREATE TABLE jobtracker_native_test (value text); INSERT INTO jobtracker_native_test VALUES ('preservar');" | Out-Null
    Stop-JobTrackerPostgres $fixture
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $configuration.port)
    try {
        $listener.Start()
        $blocked = $false
        try { Start-JobTrackerPostgres $fixture } catch { $blocked = $_.Exception.Message -match 'outro serviço' }
        if (!$blocked) { throw 'O gerenciador não bloqueou uma porta ocupada por outro serviço.' }
    } finally { $listener.Stop() }
    Start-JobTrackerPostgres $fixture
    if ((Invoke-TestSql 'SELECT value FROM jobtracker_native_test') -ne 'preservar') { throw 'Dados desapareceram após reiniciar.' }
    Write-Output 'OK: PostgreSQL real, senha obrigatória, loopback, identidade do processo, bloqueio de porta externa e dados após reiniciar.'

    if ((Invoke-TestSql 'SELECT count(*) FROM "Profile"') -ne '0') { throw 'O banco novo recebeu um perfil preexistente.' }
    $backendEntry = Join-Path $projectRoot 'recruiter-backend\dist\main.js'
    if (!(Test-Path -LiteralPath $backendEntry)) { throw 'Compile o backend antes do teste real da API.' }
    $apiPort = 0
    foreach ($candidate in 60333..60433) {
        $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidate)
        try { $probe.Start(); $apiPort = $candidate; break } catch { } finally { $probe.Stop() }
    }
    if (!$apiPort) { throw 'Nenhuma porta de teste disponível para a API.' }
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command node.exe).Source
    $startInfo.Arguments = '"' + $backendEntry + '"'
    $startInfo.WorkingDirectory = Join-Path $fixture 'recruiter-backend'
    $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['DATABASE_URL'] = "postgresql://recruit:$($configuration.password)@127.0.0.1:$($configuration.port)/recruit"
    $startInfo.EnvironmentVariables['PORT'] = [string]$apiPort
    $startInfo.EnvironmentVariables['API_HOST'] = '127.0.0.1'
    $startInfo.EnvironmentVariables['IMAP_SYNC_ON_BOOT'] = 'false'
    $startInfo.EnvironmentVariables['ANTHROPIC_API_KEY'] = ''
    $startInfo.EnvironmentVariables['IMAP_HOST'] = ''
    $startInfo.EnvironmentVariables['IMAP_USER'] = ''
    $startInfo.EnvironmentVariables['IMAP_PASSWORD'] = ''
    $startInfo.EnvironmentVariables['XDG_DATA_HOME'] = Join-Path $fixture 'data'
    $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    $apiProcess = New-Object Diagnostics.Process
    $apiProcess.StartInfo = $startInfo
    $apiProcess.Start() | Out-Null
    $apiOutput = $apiProcess.StandardOutput.ReadToEndAsync(); $apiError = $apiProcess.StandardError.ReadToEndAsync()
    $deadline = (Get-Date).AddSeconds(60)
    $ready = $false
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/profiles" -TimeoutSec 2
            $ready = $response.StatusCode -eq 200 -and $response.Content.Trim() -eq '[]'
        } catch { }
        if ($apiProcess.HasExited) { throw 'API de teste encerrou durante a inicialização.' }
        if (!$ready) { Start-Sleep -Seconds 1 }
    } while (!$ready -and (Get-Date) -lt $deadline)
    if (!$ready) { throw 'API não respondeu usando o banco nativo.' }
    $apiProcess.Kill(); $apiProcess.WaitForExit(); $apiProcess.Dispose(); $apiProcess = $null
    Write-Output 'OK: migrations completas e API real respondendo com banco nativo vazio, sem perfil pessoal e sem chamadas de IA ou email.'

    . (Join-Path $fixture 'windows\uninstall.ps1') -DefinitionsOnly
    Invoke-JobTrackerUninstall $fixture $false
    if (!(Test-Path -LiteralPath (Join-Path $fixture 'data\postgresql\PG_VERSION'))) { throw 'Desinstalação apagou o banco preservado.' }
    Expand-TestInstallation
    . (Join-Path $fixture 'windows\native-postgres.ps1') -DefinitionsOnly
    $configuration = Get-JobTrackerPostgres $fixture
    Start-JobTrackerPostgres $fixture
    if ((Invoke-TestSql 'SELECT value FROM jobtracker_native_test') -ne 'preservar') { throw 'Reinstalação não preservou o banco.' }
    Write-Output 'OK: desinstalação preservando dados e reinstalação com recuperação real do banco.'
    . (Join-Path $fixture 'windows\uninstall.ps1') -DefinitionsOnly
    Invoke-JobTrackerUninstall $fixture $true
    if (Test-Path -LiteralPath (Join-Path $fixture 'data')) { throw 'Exclusão solicitada deixou dados do banco na instalação.' }
    Write-Output 'OK: exclusão explícita removeu o banco privado de teste e os binários, sem acessar Docker ou serviços globais.'
} finally {
    if ($apiProcess) { if (!$apiProcess.HasExited) { $apiProcess.Kill(); $apiProcess.WaitForExit() }; $apiProcess.Dispose() }
    if (Test-Path -LiteralPath (Join-Path $fixture 'installation.json')) { Stop-JobTrackerPostgres $fixture }
}

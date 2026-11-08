param([switch]$SkipDependencies, [switch]$SkipShortcuts, [switch]$InstallPrerequisites)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
function Write-JobTrackerInstallProgress([int]$Completed, [string]$Message, [bool]$Indeterminate = $false) {
    Write-Output ('JOBTRACKER_PROGRESS:' + (@{completed = $Completed; message = $Message; indeterminate = $Indeterminate} | ConvertTo-Json -Compress))
}
Write-JobTrackerInstallProgress 2 'Preparando a instalação...'
$marker = Join-Path $projectRoot 'installation.json'
if (!(Test-Path -LiteralPath $marker)) {
    # A instalação se recusa a adotar arquivos de configuração de outra origem.
    foreach ($relative in @('.env', 'recruiter-backend\.env', 'recruiter-frontend\.env.local')) {
        if (Test-Path -LiteralPath (Join-Path $projectRoot $relative)) { throw 'Configuração existente sem identificação de instalação. Escolha uma pasta vazia.' }
    }
    $identity = [Guid]::NewGuid().ToString('N')
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $password = [BitConverter]::ToString($random).Replace('-', '').ToLowerInvariant()
    $databasePort = 0
    foreach ($candidatePort in 55432..55531) {
        $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidatePort)
        try { $probe.Start(); $databasePort = $candidatePort; break } catch { } finally { $probe.Stop() }
    }
    # Docker/Hyper-V pode reservar toda a faixa preferida. Pedir uma porta ao
    # Windows evita confundir uma reserva do sistema com uma instalação quebrada.
    if (!$databasePort) {
        $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
        try { $probe.Start(); $databasePort = ([Net.IPEndPoint]$probe.LocalEndpoint).Port } finally { $probe.Stop() }
    }
    if (!$databasePort) { throw 'Não foi encontrada uma porta local disponível para o banco privado.' }
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $projectRoot '.env'), "JOBTRACKER_DB_ENGINE=native-postgresql`nPOSTGRES_PORT=$databasePort`n", $encoding)
    [IO.File]::WriteAllText((Join-Path $projectRoot 'recruiter-backend\.env'), "NODE_ENV=development`nPORT=3333`nAPI_HOST=127.0.0.1`nWEB_ORIGIN=http://127.0.0.1:3000`nDATABASE_URL=postgresql://recruit:${password}@127.0.0.1:${databasePort}/recruit`nANTHROPIC_API_KEY=`nIMAP_SYNC_ON_BOOT=false`n", $encoding)
    [IO.File]::WriteAllText((Join-Path $projectRoot 'recruiter-frontend\.env.local'), "API_URL=http://127.0.0.1:3333`nNEXT_TELEMETRY_DISABLED=1`n", $encoding)
    # Sem seed e sem consulta ao banco do desenvolvedor. O usuário cria seu próprio perfil.
    @{ id = $identity; created = [DateTime]::UtcNow.ToString('o'); format = 1; database = @{engine = 'native-postgresql'; major = 16; port = $databasePort} } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $marker -Encoding UTF8
}
if (!$SkipDependencies) {
    Write-JobTrackerInstallProgress 2 'Conferindo e preparando os requisitos ausentes...' $true
    & (Join-Path $PSScriptRoot 'prerequisites.ps1') -InstallMissing:$InstallPrerequisites
    Write-JobTrackerInstallProgress 3 'Baixando e instalando as dependências...' $true
    Write-Output 'Baixando as dependências do registro npm. Isso pode demorar alguns minutos...'
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar as dependências. Confira a conexão e execute o instalador novamente.' }
    Write-JobTrackerInstallProgress 4 'Compilando os recursos compartilhados...' $true
    & npm.cmd run build:shared
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o pacote compartilhado.' }
    Write-JobTrackerInstallProgress 5 'Preparando o acesso ao banco de dados...' $true
    & npm.cmd run prisma:generate -w recruiter-backend
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o cliente do banco.' }
}
Write-JobTrackerInstallProgress 6 'Gerando a extensão e os atalhos...' $true
# Gerar na máquina de destino: nenhum caminho do computador de origem é transportado.
& (Join-Path $projectRoot 'scripts\build-extension.ps1')
if (!$SkipShortcuts) {
    . (Join-Path $PSScriptRoot 'shortcuts.ps1')
    New-JobTrackerShortcuts $projectRoot
}
Write-JobTrackerInstallProgress 6 'Finalizando a instalação...'
Write-Output 'Instalação preparada. Abra o Job Tracker pelo atalho na área de trabalho.'

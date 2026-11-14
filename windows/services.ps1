param([ValidateSet('start', 'stop', 'cancel')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtime = Join-Path $projectRoot 'dist\windows\runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$stateFile = Join-Path $runtime 'processes.json'
$lockFile = Join-Path $runtime 'services.lock'
$lock = $null
$installation = $null
if (Test-Path -LiteralPath (Join-Path $projectRoot 'installation.json')) { $installation = Get-Content -LiteralPath (Join-Path $projectRoot 'installation.json') -Raw | ConvertFrom-Json }
$nativeDatabase = $installation -and $installation.database.engine -eq 'native-postgresql'
$startupFile = Join-Path $runtime 'startup.json'
$operationId = $null
$requestFile = $null
if ($Action -eq 'cancel') {
    if (!(Test-Path -LiteralPath $startupFile)) { Write-Output 'Aguardando a inicialização registrar sua operação...'; exit 3 }
    $startup = Get-Content -LiteralPath $startupFile -Raw | ConvertFrom-Json
    $starter = Get-Process -Id $startup.processId -ErrorAction SilentlyContinue
    if (!$starter -or $startup.id -notmatch '^[a-f0-9]{32}$' -or $starter.StartTime.ToUniversalTime().ToString('o') -ne $startup.started) { exit 3 }
    [IO.File]::WriteAllText((Join-Path $runtime ('stop-' + $startup.id + '.request')), 'stop')
    Write-Output 'Parada solicitada. A etapa atual será concluída com segurança antes de encerrar os serviços.'
    exit 0
}
try {
    try { $lock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Outra operação do painel está em andamento. Aguarde e tente novamente.' }
    if ($Action -eq 'start') {
        $operationId = [Guid]::NewGuid().ToString('N')
        $requestFile = Join-Path $runtime ('stop-' + $operationId + '.request')
        $startupTemporary = Join-Path $runtime ('startup-' + $operationId + '.tmp')
        @{id = $operationId; processId = $PID; started = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $startupTemporary -Encoding UTF8
        Move-Item -LiteralPath $startupTemporary -Destination $startupFile -Force
    }
    $owned = @()
    if (Test-Path -LiteralPath $stateFile) {
        $savedProcesses = Get-Content $stateFile -Raw | ConvertFrom-Json
        foreach ($record in $savedProcesses) { if ($null -ne $record) { $owned += $record } }
    }
    function Save-Processes { ConvertTo-Json -InputObject @($script:owned) | Set-Content -LiteralPath $stateFile -Encoding UTF8 }
    function Test-StopRequest {
        if ($requestFile -and (Test-Path -LiteralPath $requestFile)) { throw (New-Object OperationCanceledException('Parada solicitada pelo usuário.')) }
    }
    function Stop-OwnedServices {
        foreach ($entry in $script:owned) {
            $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
            if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.started) {
                $previousPreference = $ErrorActionPreference
                try {
                    # Um filho pode encerrar durante a enumeração da árvore. Não
                    # abandonar a parada do banco por um aviso de processo já encerrado.
                    $ErrorActionPreference = 'Continue'
                    & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
                } finally { $ErrorActionPreference = $previousPreference }
                $process.WaitForExit(5000) | Out-Null
                $remaining = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
                if ($remaining -and $remaining.StartTime.ToUniversalTime().ToString('o') -eq $entry.started) { throw "Não foi possível parar $($entry.name)." }
            }
        }
        $script:owned = @()
        Save-Processes
        if ($nativeDatabase) { & (Join-Path $PSScriptRoot 'native-postgres.ps1') -Action stop -InstallRoot $projectRoot }
        else { Stop-OwnedDockerDatabase }
        Write-Output 'Serviços desta instalação encerrados. Outros aplicativos e bancos foram mantidos.'
    }
    function Stop-OwnedDockerDatabase {
        $compose = if ($installation) { Join-Path $projectRoot 'windows\docker-compose.install.yml' } else { Join-Path $projectRoot 'docker-compose.yml' }
        if (!(Test-Path -LiteralPath $compose)) { return }
        if (!(Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Não foi possível conferir o PostgreSQL Docker. Disponibilize o Docker para concluir a parada.' }
        $ids = @(& docker.exe compose -f $compose ps --status running -q postgres)
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar o PostgreSQL Docker desta instalação.' }
        foreach ($id in $ids) {
            if ($id -notmatch '^[a-f0-9]{12,64}$') { throw 'Identificação inesperada do banco Docker.' }
            $labelsJson = & docker.exe inspect $id --format '{{json .Config.Labels}}'
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível conferir a pasta do banco Docker.' }
            $labels = ($labelsJson -join "`n") | ConvertFrom-Json
            $owner = $labels.PSObject.Properties['com.docker.compose.project.working_dir'].Value
            if (![string]::Equals(([string]$owner).TrimEnd('\', '/'), $projectRoot.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
                Write-Output 'Banco Docker de outra pasta foi preservado.'; continue
            }
            & docker.exe stop --time 60 $id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível parar o PostgreSQL Docker. Seus dados foram mantidos.' }
            $running = & docker.exe inspect $id --format '{{.State.Running}}'
            if ($LASTEXITCODE -ne 0 -or $running -ne 'false') { throw 'O PostgreSQL Docker ainda não confirmou a parada.' }
            Write-Output 'PostgreSQL Docker desta instalação encerrado. Volume e dados preservados.'
        }
    }
    function Test-Service([string]$Url, [string]$Pattern) {
        try {
            $result = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
            return ($result.StatusCode -eq 200 -and $result.Content -match $Pattern)
        } catch { return $false }
    }
    function Test-Listener([int]$Port) {
        return @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $Port).Count -gt 0
    }
    function Test-Docker {
        try {
            & docker.exe info --format '{{.ServerVersion}}' 2>$null | Out-Null
            return $LASTEXITCODE -eq 0
        } catch { return $false }
    }
    function Start-Owned([string]$Name, [string]$Arguments) {
        $stdout = Join-Path $runtime "$Name-output.log"
        $stderr = Join-Path $runtime "$Name-error.log"
        # Evita substituir logs de processos anteriores que ainda estejam rodando.
        $running = @($script:owned | Where-Object {
            $existing = Get-Process -Id $_.id -ErrorAction SilentlyContinue
            $existing -and $existing.StartTime.ToUniversalTime().ToString('o') -eq $_.started
        })
        if (@($running | Where-Object name -eq $Name).Count) {
            throw "$Name já está iniciando. Confira os registros ou use Parar serviços antes de tentar novamente."
        }
        $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"npm.cmd $Arguments`"" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $script:owned = @($running) + @(@{ name = $Name; id = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o') })
        Save-Processes
        return $process
    }
    function Wait-Service([string]$Url, [string]$Pattern, $Process, [int]$Seconds) {
        $deadline = (Get-Date).AddSeconds($Seconds)
        do {
            Test-StopRequest
            if (Test-Service $Url $Pattern) { return }
            if ($Process.HasExited) { throw "O serviço encerrou durante a inicialização. Confira os arquivos em $runtime" }
            Start-Sleep -Seconds 2
        } while ((Get-Date) -lt $deadline)
        throw "O serviço demorou para responder em $Url. Confira os registros em $runtime ou aguarde e abra novamente."
    }
    if ($Action -eq 'stop') {
        Stop-OwnedServices
        exit 0
    }
    Test-StopRequest
    # O painel aberto pelo instalador pode ter herdado o PATH anterior à instalação dos requisitos.
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'installation.json')) {
        $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = [Environment]::ExpandEnvironmentVariables("$machinePath;$userPath;$env:Path")
    }
    if (!(Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Instale o Node.js 20.9 ou superior e reabra o painel.' }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\next\package.json'))) { throw 'Dependências ausentes. Execute npm install na pasta do projeto.' }
    $installed = Test-Path -LiteralPath (Join-Path $projectRoot 'installation.json')
    if ($installed) {
        $liveOwned = @($owned | Where-Object {
            $candidate = Get-Process -Id $_.id -ErrorAction SilentlyContinue
            $candidate -and $candidate.StartTime.ToUniversalTime().ToString('o') -eq $_.started
        })
        if ((Test-Listener 3333) -and !@($liveOwned | Where-Object name -eq 'api').Count) {
            throw 'Outra instalação está usando a porta 3333. Pare a outra aplicação antes de iniciar esta; os perfis não serão compartilhados.'
        }
        if ((Test-Listener 3000) -and !@($liveOwned | Where-Object name -eq 'web').Count) {
            throw 'Outra instalação está usando a porta 3000. Pare a outra interface antes de iniciar esta.'
        }
        $env:XDG_DATA_HOME = Join-Path $projectRoot 'data'
        $env:NEXT_TELEMETRY_DISABLED = '1'
    }
    $apiReady = Test-Service 'http://127.0.0.1:3333/profiles' '^\s*\['
    $protectedKey = Join-Path $runtime 'anthropic.key'
    if (Test-Path -LiteralPath $protectedKey) {
        Add-Type -AssemblyName System.Security
        try {
            $keyBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($protectedKey), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            $env:ANTHROPIC_API_KEY = [Text.Encoding]::UTF8.GetString($keyBytes)
            [Array]::Clear($keyBytes, 0, $keyBytes.Length)
        } catch { throw 'Não foi possível ler a chave de API deste usuário Windows. Configure novamente pelo painel.' }
    }
    if (!$apiReady) {
        Test-StopRequest
        if (Test-Listener 3333) { throw 'A porta 3333 está ocupada, mas a API não respondeu corretamente. Confira os registros do serviço existente.' }
        if ($nativeDatabase) {
            Write-Output 'Iniciando o PostgreSQL privado do Job Tracker...'
            & (Join-Path $PSScriptRoot 'native-postgres.ps1') -Action start -InstallRoot $projectRoot
            Test-StopRequest
        } else {
        if (!(Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Instale e inicie o Docker Desktop para usar o banco local.' }
        if (!(Test-Docker)) {
            $dockerDesktop = @((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if (!$dockerDesktop) { throw 'Inicie o Docker e tente novamente.' }
            Write-Output 'Iniciando o Docker Desktop...'
            Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
            $deadline = (Get-Date).AddSeconds(120)
            do {
                Test-StopRequest
                Start-Sleep -Seconds 3
                $dockerReady = Test-Docker
            } while (!$dockerReady -and (Get-Date) -lt $deadline)
            if (!$dockerReady) { throw 'Docker não iniciou a tempo. Abra o Docker Desktop e conclua o primeiro uso. Se ele pedir WSL, virtualização ou reinicialização, siga o Guia de uso e tente novamente.' }
        }
        Write-Output 'Preparando banco de dados...'
        if ($installed) { & docker.exe compose -f windows/docker-compose.install.yml up -d --wait --wait-timeout 90 }
        else { & docker.exe compose up -d --wait --wait-timeout 90 }
        if ($LASTEXITCODE -ne 0) { throw 'O banco não ficou pronto. Verifique o Docker Desktop.' }
        }
        Test-StopRequest
        & npm.cmd run build:shared
        Test-StopRequest
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o pacote compartilhado.' }
        & npm.cmd run db:deploy
        Test-StopRequest
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar as migrations. Confira a configuração do banco.' }
        Write-Output 'Iniciando API local...'
        $api = Start-Owned 'api' 'run dev:worker'
        Wait-Service 'http://127.0.0.1:3333/profiles' '^\s*\[' $api 180
    } else { Write-Output 'API já ativa. Reutilizando.' }
    if (!(Test-Service 'http://127.0.0.1:3000/api/health' '"app"\s*:\s*"job-tracker"')) {
        Test-StopRequest
        if (Test-Listener 3000) { throw 'A porta 3000 está ocupada, mas o Job Tracker não respondeu corretamente. Confira o serviço existente.' }
        Write-Output 'Iniciando interface local...'
        # Webpack evita o erro de CRC observado no cache local do Turbopack.
        $web = Start-Owned 'web' 'run dev -w recruiter-frontend -- --webpack'
        Wait-Service 'http://127.0.0.1:3000/api/health' '"app"\s*:\s*"job-tracker"' $web 240
    } else { Write-Output 'Interface já ativa. Reutilizando.' }
    Test-StopRequest
    Write-Output 'Job Tracker pronto: http://127.0.0.1:3000'
} catch {
    if ($_.Exception -is [OperationCanceledException]) {
        Stop-OwnedServices
        Write-Output 'Inicialização cancelada e serviços encerrados.'
        exit 2
    }
    Write-Output ("ERRO: " + $_.Exception.Message)
    exit 1
} finally {
    if ($operationId) {
        if (Test-Path -LiteralPath $startupFile) { Remove-Item -LiteralPath $startupFile -Force }
        if ($requestFile -and (Test-Path -LiteralPath $requestFile)) { Remove-Item -LiteralPath $requestFile -Force }
    }
    if ($lock) { $lock.Dispose() }
}

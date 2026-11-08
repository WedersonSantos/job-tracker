param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status', [string]$InstallRoot, [switch]$DefinitionsOnly)

function Get-JobTrackerNativePath([string]$Path, [switch]$Long) {
    if (!('JobTrackerWindowsPath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JobTrackerWindowsPath {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetShortPathName(string path, StringBuilder output, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetLongPathName(string path, StringBuilder output, uint length);
}
'@
    }
    $buffer = New-Object Text.StringBuilder 32768
    if ($Long) { $size = [JobTrackerWindowsPath]::GetLongPathName($Path, $buffer, $buffer.Capacity) }
    else { $size = [JobTrackerWindowsPath]::GetShortPathName($Path, $buffer, $buffer.Capacity) }
    if (!$size -or $size -ge $buffer.Capacity) { throw 'Não foi possível resolver o caminho do PostgreSQL no Windows.' }
    $resolved = $buffer.ToString()
    if (!$Long) {
        # Só substituir os componentes com acentos. Encurtar também nomes ASCII
        # pode resolver um alias de outra pasta em volumes com nomes semelhantes.
        $originalParts = [IO.Path]::GetFullPath($Path).Split('\')
        $shortParts = $resolved.Split('\')
        if ($originalParts.Length -ne $shortParts.Length) { throw 'Alias PostgreSQL inconsistente. Escolha uma pasta sem acentos.' }
        for ($index = 0; $index -lt $originalParts.Length; $index++) {
            if ($originalParts[$index] -notmatch '[^\x00-\x7F]') { $shortParts[$index] = $originalParts[$index] }
        }
        $resolved = $shortParts -join '\'
        $confirmed = Get-JobTrackerNativePath $resolved -Long
        if (!$confirmed.TrimEnd('\').Equals([IO.Path]::GetFullPath($Path).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'O alias aponta para outra pasta. Escolha uma pasta sem acentos.' }
    }
    return $resolved
}

function Get-JobTrackerPostgres([string]$Root) {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $identity = Get-Content -LiteralPath (Join-Path $rootPath 'installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($identity.id -notmatch '^[a-f0-9]{32}$' -or $identity.database.engine -ne 'native-postgresql' -or $identity.database.major -ne 16) { throw 'Esta instalação não está configurada para PostgreSQL privado 16.' }
    $environment = [IO.File]::ReadAllText((Join-Path $rootPath 'recruiter-backend\.env'))
    $connection = [regex]::Match($environment, '(?m)^DATABASE_URL=postgresql://recruit:([a-f0-9]{64})@127\.0\.0\.1:(\d+)/recruit\r?$')
    if (!$connection.Success) { throw 'A configuração do banco privado foi alterada ou está incompleta. Nenhum banco externo será adotado.' }
    $port = [int]$connection.Groups[2].Value
    if ($port -lt 1024 -or $port -gt 65535 -or $port -ne $identity.database.port) { throw 'Porta do banco privado inconsistente.' }
    # initdb usa APIs ANSI em partes da inicialização no Windows. O alias 8.3
    # preserva a pasta escolhida, sem mudar o sistema ou mover os dados.
    $nativeRoot = $rootPath
    if ($nativeRoot -match '[^\x00-\x7F]') { $nativeRoot = Get-JobTrackerNativePath $rootPath }
    if ($nativeRoot -match '[^\x00-\x7F]') { throw 'Este volume não oferece alias compatível para caminhos com acentos. Escolha uma pasta sem acentos para o Job Tracker.' }
    return @{
        root = $rootPath; id = $identity.id; port = $port; password = $connection.Groups[1].Value;
        bin = Join-Path $nativeRoot 'runtime\postgresql\bin'; cluster = Join-Path $nativeRoot 'data\postgresql';
        owner = Join-Path $nativeRoot 'data\postgresql-owner.json'; logs = Join-Path $nativeRoot 'dist\windows\runtime'
    }
}

function ConvertTo-JobTrackerArgument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-JobTrackerPostgresCommand([string]$File, [string[]]$Arguments, [hashtable]$Configuration, [int]$Timeout = 90) {
    if (!(Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Binários PostgreSQL não encontrados. Reinstale o Job Tracker preservando os dados.' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.WorkingDirectory = $Configuration.root
    $info.Arguments = (@($Arguments | ForEach-Object { ConvertTo-JobTrackerArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $info.EnvironmentVariables['PGPASSWORD'] = $Configuration.password
    $info.EnvironmentVariables['PGCLIENTENCODING'] = 'UTF8'
    $info.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '5'
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        $process.Start() | Out-Null
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($Timeout * 1000)) { $process.Kill(); throw 'O comando PostgreSQL excedeu o tempo de espera. Confira o registro local.' }
        # No Windows, o servidor destacado por pg_ctl pode manter handles herdados.
        # Não aguardar indefinidamente pelo EOF desses pipes depois que pg_ctl encerrou.
        $readComplete = [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 2000)
        if (!$readComplete -and [IO.Path]::GetFileName($File) -ne 'pg_ctl.exe') { throw 'A saída do comando PostgreSQL não foi concluída.' }
        $output = ''; $errorText = ''
        if ($stdout.IsCompleted) { $output = $stdout.GetAwaiter().GetResult().Trim() }
        if ($stderr.IsCompleted) { $errorText = $stderr.GetAwaiter().GetResult().Trim() }
        return @{ code = $process.ExitCode; output = $output; error = $errorText }
    } finally { $process.Dispose() }
}

function Assert-JobTrackerCluster([hashtable]$Configuration) {
    $config = $Configuration
    if (!(Test-Path -LiteralPath $config.owner)) { throw 'O banco não tem identificação desta instalação. Os arquivos existentes foram preservados.' }
    $owner = Get-Content -LiteralPath $config.owner -Raw | ConvertFrom-Json
    if ($owner.installationId -ne $config.id -or $owner.major -ne 16) { throw 'Banco de outra instalação ou versão. Nenhum arquivo foi alterado.' }
    if (([IO.File]::GetAttributes($config.cluster) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A pasta do banco não pode ser um link.' }
    if ([IO.File]::ReadAllText((Join-Path $config.cluster 'PG_VERSION')).Trim() -ne '16') { throw 'O banco usa outra versão principal. É necessária uma migração explícita.' }
}

function Test-JobTrackerPostgresProcess([hashtable]$Configuration) {
    $pidFile = Join-Path $Configuration.cluster 'postmaster.pid'
    if (!(Test-Path -LiteralPath $pidFile)) { return $false }
    Assert-JobTrackerCluster $Configuration
    $lines = [IO.File]::ReadAllLines($pidFile)
    if ($lines.Length -lt 2 -or $lines[0] -notmatch '^\d+$') { throw 'Identificação do processo PostgreSQL inválida.' }
    $expectedCluster = Get-JobTrackerNativePath $Configuration.cluster -Long
    if (!(Get-JobTrackerNativePath ([IO.Path]::GetFullPath($lines[1])) -Long).TrimEnd('\').Equals($expectedCluster, [StringComparison]::OrdinalIgnoreCase)) { throw 'O processo aponta para outro banco.' }
    $process = Get-Process -Id ([int]$lines[0]) -ErrorAction SilentlyContinue
    if (!$process) { return $false }
    $expected = Join-Path $Configuration.bin 'postgres.exe'
    if (!$process.Path -or !(Get-JobTrackerNativePath $process.Path -Long).Equals((Get-JobTrackerNativePath $expected -Long), [StringComparison]::OrdinalIgnoreCase)) { throw 'O PID registrado pertence a outro programa. Não será encerrado.' }
    $details = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $process.Id) -OperationTimeoutSec 10
    $match = [regex]::Match($details.CommandLine, '(?i)(?:^|\s)"?-D"?\s+(?:"([^"]+)"|(\S+))')
    $argument = $match.Groups[1].Value
    if (!$argument) { $argument = $match.Groups[2].Value }
    if (!$match.Success -or !(Get-JobTrackerNativePath ([IO.Path]::GetFullPath($argument)) -Long).TrimEnd('\').Equals($expectedCluster, [StringComparison]::OrdinalIgnoreCase)) { throw 'O processo PostgreSQL pertence a outra pasta. Não será encerrado.' }
    return $true
}

function Stop-JobTrackerPostgres([string]$Root) {
    $config = Get-JobTrackerPostgres $Root
    if (!(Test-Path -LiteralPath (Join-Path $config.cluster 'postmaster.pid'))) { return }
    if (!(Test-JobTrackerPostgresProcess $config)) { return }
    $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'pg_ctl.exe') @('stop', '-D', $config.cluster, '-m', 'fast', '-w', '-t', '60') $config
    if ($result.code -ne 0) { throw 'Não foi possível encerrar o PostgreSQL privado de forma limpa. Os dados foram mantidos.' }
    Write-Output 'PostgreSQL privado encerrado de forma limpa.'
}

function Start-JobTrackerPostgres([string]$Root) {
    $config = Get-JobTrackerPostgres $Root
    New-Item -ItemType Directory -Force -Path $config.logs | Out-Null
    $lock = $null
    try {
        $lock = [IO.File]::Open((Join-Path $config.logs 'postgres.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $binary = Join-Path $config.bin 'postgres.exe'
        $version = Invoke-JobTrackerPostgresCommand $binary @('--version') $config
        if ($version.code -ne 0 -or $version.output -notmatch '^postgres \(PostgreSQL\) 16\.') { throw 'O runtime PostgreSQL não pôde executar. Confira o Microsoft Visual C++ x64 pelo instalador.' }
        $versionFile = Join-Path $config.cluster 'PG_VERSION'
        if (!(Test-Path -LiteralPath $versionFile)) {
            if ((Test-Path -LiteralPath $config.cluster) -and [IO.Directory]::GetFileSystemEntries($config.cluster).Length -gt 0) { throw 'A pasta do banco contém uma inicialização incompleta. Não será apagada automaticamente.' }
            $occupied = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $config.port).Count -gt 0
            if ($occupied) { throw 'A porta do banco privado está ocupada por outro serviço. Nenhum banco externo será usado.' }
            $passwordFile = Join-Path $config.logs ([Guid]::NewGuid().ToString('N') + '.pw')
            try {
                [IO.File]::WriteAllText($passwordFile, $config.password + "`n", (New-Object Text.UTF8Encoding($false)))
                $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'initdb.exe') @('-D', $config.cluster, '-U', 'recruit', '--encoding=UTF8', '--locale=C', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', ('--pwfile=' + $passwordFile), '--no-instructions') $config
                if ($result.code -ne 0) {
                    [IO.File]::WriteAllText((Join-Path $config.logs 'postgres-init.log'), ($result.output + "`n" + $result.error), (New-Object Text.UTF8Encoding($false)))
                    throw 'Não foi possível inicializar o banco privado. Confira postgres-init.log nos registros locais; arquivos existentes foram preservados.'
                }
                @{installationId = $config.id; major = 16} | ConvertTo-Json | Set-Content -LiteralPath $config.owner -Encoding UTF8
            } finally { if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force } }
        }
        Assert-JobTrackerCluster $config
        if (!(Test-JobTrackerPostgresProcess $config)) {
            $occupied = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $config.port).Count -gt 0
            if ($occupied) { throw 'A porta do PostgreSQL pertence a outro serviço. Nenhum banco externo será usado.' }
            $settings = "listen_addresses = '127.0.0.1'`nport = $($config.port)`npassword_encryption = 'scram-sha-256'`nmax_connections = 30`nshared_buffers = '32MB'`nlogging_collector = off`n"
            [IO.File]::WriteAllText((Join-Path $config.cluster 'jobtracker.conf'), $settings, (New-Object Text.UTF8Encoding($false)))
            $mainConfiguration = Join-Path $config.cluster 'postgresql.conf'
            if (![IO.File]::ReadAllText($mainConfiguration).Contains("include = 'jobtracker.conf'")) { [IO.File]::AppendAllText($mainConfiguration, "`ninclude = 'jobtracker.conf'`n", (New-Object Text.UTF8Encoding($false))) }
            $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'pg_ctl.exe') @('start', '-D', $config.cluster, '-l', (Join-Path $config.logs 'postgresql.log'), '-w', '-t', '60') $config
            if ($result.code -ne 0) { throw 'O PostgreSQL privado não iniciou. Confira postgresql.log nos registros locais.' }
        }
        $connectionArguments = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$config.port, '-U', 'recruit', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1')
        $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'psql.exe') ($connectionArguments + @('-c', "SELECT current_setting('data_directory')")) $config
        if ($result.code -ne 0 -or !(Get-JobTrackerNativePath ([IO.Path]::GetFullPath($result.output)) -Long).TrimEnd('\').Equals((Get-JobTrackerNativePath $config.cluster -Long), [StringComparison]::OrdinalIgnoreCase)) { throw 'Não foi possível confirmar a identidade e a autenticação do banco privado.' }
        $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'psql.exe') ($connectionArguments + @('-c', "SELECT 1 FROM pg_database WHERE datname = 'recruit'")) $config
        if ($result.code -ne 0) { throw 'Não foi possível verificar o banco da aplicação.' }
        if ($result.output -ne '1') {
            $result = Invoke-JobTrackerPostgresCommand (Join-Path $config.bin 'createdb.exe') @('-w', '-h', '127.0.0.1', '-p', [string]$config.port, '-U', 'recruit', '-O', 'recruit', 'recruit') $config
            if ($result.code -ne 0) { throw 'Não foi possível criar o banco da aplicação.' }
        }
        Write-Output 'PostgreSQL privado pronto, com senha e acesso apenas em 127.0.0.1.'
    } finally { if ($lock) { $lock.Dispose() } }
}

if (!$DefinitionsOnly) {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    if ($Action -eq 'start') { Start-JobTrackerPostgres $InstallRoot }
    elseif ($Action -eq 'stop') { Stop-JobTrackerPostgres $InstallRoot }
    else { $config = Get-JobTrackerPostgres $InstallRoot; Test-JobTrackerPostgresProcess $config }
}

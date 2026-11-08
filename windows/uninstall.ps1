param([string]$InstallRoot, [switch]$DeleteData, [switch]$PlanOnly, [switch]$DefinitionsOnly, [string]$CompletionFile)

function Get-JobTrackerUninstallPlan([string]$Root, [bool]$EraseData) {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($rootPath.StartsWith('\\') -or $rootPath -eq [IO.Path]::GetPathRoot($rootPath).TrimEnd('\')) { throw 'Pasta de instalação inválida.' }
    if (!(Test-Path -LiteralPath $rootPath -PathType Container)) { throw 'Instalação não encontrada.' }
    $identity = Get-Content -LiteralPath (Join-Path $rootPath 'installation.json') -Raw | ConvertFrom-Json
    if ($identity.id -notmatch '^[a-f0-9]{32}$' -or $identity.format -ne 1) { throw 'Identificação de instalação inválida. Nenhum arquivo foi removido.' }
    $prefix = $rootPath + '\'
    $records = Get-Content -LiteralPath (Join-Path $rootPath 'windows\installed-files.json') -Raw | ConvertFrom-Json
    $files = @()
    foreach ($record in $records) {
        $relative = [string]$record.path
        $target = [IO.Path]::GetFullPath((Join-Path $rootPath $relative))
        if ([IO.Path]::IsPathRooted($relative) -or !$target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Lista de arquivos inválida. Nenhum arquivo foi removido.' }
        $files += $target
    }
    $files += Join-Path $rootPath 'windows\installed-files.json'
    $trees = @('node_modules', 'recruiter-backend\node_modules', 'recruiter-frontend\node_modules', 'packages\shared\node_modules',
        'recruiter-backend\dist', 'recruiter-backend\src\generated', 'recruiter-frontend\.next', 'packages\shared\dist', 'dist\chrome')
    foreach ($relative in @('recruiter-frontend\tsconfig.tsbuildinfo', 'recruiter-backend\tsconfig.tsbuildinfo', 'recruiter-backend\tsconfig.build.tsbuildinfo', 'packages\shared\tsconfig.tsbuildinfo')) { $files += Join-Path $rootPath $relative }
    if ($EraseData) {
        $trees += @('data', 'dist\windows\runtime')
        foreach ($relative in @('.env', 'recruiter-backend\.env', 'recruiter-frontend\.env.local', 'installation.json')) { $files += Join-Path $rootPath $relative }
    }
    return @{ root = $rootPath; project = ('jobtracker-' + $identity.id); files = $files; trees = $trees; eraseData = $EraseData }
}

function Remove-JobTrackerPath([string]$Target, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Target)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (!$absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Remoção fora da instalação foi bloqueada.' }
    if (!(Test-Path -LiteralPath $absolute)) { return }
    # Verificar ancestrais antes de alcançar um arquivo. Nunca atravessar junções.
    $ancestor = Split-Path $absolute -Parent
    while ($ancestor -and $ancestor.Length -ge $prefix.Length - 1) {
        if (([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A pasta contém um link. Remoção interrompida.' }
        $ancestor = Split-Path $ancestor -Parent
    }
    $attributes = [IO.File]::GetAttributes($absolute)
    if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            foreach ($child in [IO.Directory]::GetFileSystemEntries($absolute)) { Remove-JobTrackerPath $child $Root }
        }
        [IO.Directory]::Delete($absolute, $false)
    } else {
        if (($attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) { [IO.File]::SetAttributes($absolute, ($attributes -band (-bnot [IO.FileAttributes]::ReadOnly))) }
        [IO.File]::Delete($absolute)
    }
}

function Remove-JobTrackerFiles($Plan, [int]$TimeoutSeconds = 20) {
    $targets = @(@($Plan.trees | ForEach-Object { Join-Path $Plan.root $_ }) + @($Plan.files) | Select-Object -Unique)
    $controlFiles = @('installation.json', 'windows\installed-files.json', 'windows\uninstall.ps1', 'windows\services.ps1', 'windows\native-postgres.ps1') | ForEach-Object { Join-Path $Plan.root $_ }
    $regularTargets = @($targets | Where-Object { $controlFiles -notcontains $_ })
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        foreach ($target in $targets) {
            if ($controlFiles -contains $target) {
                if (@($regularTargets | Where-Object { Test-Path -LiteralPath $_ -ErrorAction Stop }).Count) { continue }
            }
            try { Remove-JobTrackerPath $target $Plan.root }
            catch [IO.IOException] { } # Arquivo ainda em uso: conferir novamente antes de concluir.
            catch [UnauthorizedAccessException] { }
        }
        $pending = @($targets | Where-Object { Test-Path -LiteralPath $_ -ErrorAction Stop })
        Write-Output "Conferindo a pasta: $($targets.Count - $pending.Count) de $($targets.Count) itens removidos."
        if (!$pending.Count) { return }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw ("Desinstalação incompleta. Ainda há arquivos em uso ou sem permissão: " + ($pending -join '; '))
        }
        Start-Sleep -Milliseconds 400
    } while ($true)
}

function Stop-JobTrackerDatabase([string]$Project, [bool]$EraseData) {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = [Environment]::ExpandEnvironmentVariables("$machinePath;$userPath;$env:Path")
    if (!(Get-Command docker.exe -ErrorAction SilentlyContinue)) {
        if ($EraseData) { throw 'Docker indisponível. Para excluir o banco, disponibilize o Docker e tente novamente, ou escolha preservar os dados.' }
        Write-Output 'Docker indisponível. O banco foi preservado.'; return
    }
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker.exe info --format '{{.ServerVersion}}' 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            if ($EraseData) { throw 'Inicie o Docker para excluir o banco, ou escolha preservar os dados.' }
            Write-Output 'Docker desligado. O banco foi preservado.'; return
        }
        $containers = @(& docker.exe ps -a --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}')
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar os contêineres da instalação.' }
        foreach ($id in $containers) {
            if ($id -notmatch '^[a-f0-9]{12,64}$') { throw 'Identificação inesperada de contêiner.' }
            & docker.exe container rm --force $id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível encerrar o banco desta instalação.' }
        }
        $networks = @(& docker.exe network ls --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}')
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar a rede do banco.' }
        foreach ($id in $networks) {
            if ($id -notmatch '^[a-f0-9]{12,64}$') { throw 'Identificação inesperada de rede.' }
            & docker.exe network rm $id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível remover a rede desta instalação. Verifique se está em uso.' }
        }
        if ($EraseData) {
            $volume = $Project + '_postgres-data'
            $volumes = @(& docker.exe volume ls --format '{{.Name}}')
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar o volume da instalação.' }
            if ($volumes -contains $volume) {
                & docker.exe volume rm $volume | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Não foi possível excluir o banco. Seus arquivos ainda foram mantidos.' }
            }
        }
    } finally { $ErrorActionPreference = $previousPreference }
}

function Invoke-JobTrackerUninstall([string]$Root, [bool]$EraseData) {
    $plan = Get-JobTrackerUninstallPlan $Root $EraseData
    $panel = Join-Path $plan.root 'dist\windows\JobTracker.exe'
    if (Test-Path -LiteralPath $panel) {
        try { $probe = [IO.File]::Open($panel, 'Open', 'ReadWrite', 'None'); $probe.Dispose() }
        catch { throw 'Feche o painel Job Tracker antes de desinstalar. Nenhum dado foi removido.' }
    }
    Write-Output 'Encerrando apenas os serviços desta instalação...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $plan.root 'windows\services.ps1') -Action stop
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível parar os serviços. Nenhum arquivo do programa foi removido.' }
    $identity = Get-Content -LiteralPath (Join-Path $plan.root 'installation.json') -Raw | ConvertFrom-Json
    if ($identity.database.engine -eq 'native-postgresql') {
        if ($EraseData -and (Test-Path -LiteralPath (Join-Path $plan.root 'data\postgresql\PG_VERSION'))) {
            . (Join-Path $plan.root 'windows\native-postgres.ps1') -DefinitionsOnly
            Assert-JobTrackerCluster (Get-JobTrackerPostgres $plan.root)
        }
    } else { Stop-JobTrackerDatabase $plan.project $EraseData }
    $shell = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Job Tracker'
    foreach ($link in @((Join-Path $menu 'Job Tracker.lnk'), (Join-Path $menu 'Guia do Job Tracker.lnk'), (Join-Path $menu 'Desinstalar Job Tracker.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Job Tracker.lnk'))) {
        if ((Test-Path -LiteralPath $link) -and $shell.CreateShortcut($link).TargetPath.StartsWith($plan.root + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $link -Force }
    }
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JobTracker'
    if (Test-Path $registry) {
        $registration = Get-ItemProperty -Path $registry
        if ($registration.InstallLocation -eq $plan.root) { Remove-Item -Path $registry -Force }
    }
    Write-Output 'Removendo arquivos do programa...'
    Remove-JobTrackerFiles $plan
    # Remover pastas vazias somente; arquivos desconhecidos não são apagados.
    $directories = @($plan.files | ForEach-Object { Split-Path $_ -Parent } | Sort-Object -Unique | Sort-Object Length -Descending)
    foreach ($directory in $directories) {
        while ($directory -and $directory.StartsWith($plan.root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            if (!(Test-Path -LiteralPath $directory) -or [IO.Directory]::GetFileSystemEntries($directory).Length -ne 0) { break }
            [IO.Directory]::Delete($directory)
            $directory = Split-Path $directory -Parent
        }
    }
    if ([IO.Directory]::GetFileSystemEntries($plan.root).Length -eq 0) { [IO.Directory]::Delete($plan.root) }
    $remaining = @(@($plan.trees | ForEach-Object { Join-Path $plan.root $_ }) + @($plan.files) | Where-Object { Test-Path -LiteralPath $_ -ErrorAction Stop })
    if ($remaining.Count) { throw ('A conferência final encontrou itens pendentes: ' + ($remaining -join '; ')) }
    Write-Output 'Conferência concluída: os arquivos previstos foram removidos.'
    if ($EraseData) { Write-Output 'Job Tracker removido, incluindo o banco, anexos e configurações desta instalação. Arquivos desconhecidos foram mantidos.' }
    else { Write-Output 'Programa removido. Seus dados e configurações foram preservados para reinstalação. Requisitos compartilhados não foram removidos.' }
}

if (!$DefinitionsOnly) {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    if ($PlanOnly) { Get-JobTrackerUninstallPlan $InstallRoot ([bool]$DeleteData) | ConvertTo-Json -Depth 5 }
    else {
        Invoke-JobTrackerUninstall $InstallRoot ([bool]$DeleteData)
        if ($CompletionFile) { [IO.File]::WriteAllText($CompletionFile, 'JOBTRACKER_UNINSTALL_COMPLETE') }
    }
}

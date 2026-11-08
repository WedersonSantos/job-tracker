$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$fixtureRoot = Join-Path $projectRoot ('tmp\windows-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$output = Join-Path $fixtureRoot 'extension'
& (Join-Path $projectRoot 'scripts\build-extension.ps1') -OutputDirectory $output
& (Join-Path $projectRoot 'scripts\build-extension.ps1') -OutputDirectory $output
$manifest = Get-Content (Join-Path $projectRoot 'chrome-extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $output ("job-tracker-chrome-" + $manifest.version + '.zip')))
try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    foreach ($required in @('manifest.json', $manifest.background.service_worker, $manifest.action.default_popup, 'INSTALAR.txt') + @($manifest.content_scripts.js)) {
        if ($entries -notcontains $required) { throw "Pacote não contém $required" }
    }
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -match '\.env|\.pdf$|\.csv$|[/\\]|processes\.json') { throw "Arquivo inesperado no pacote: $($entry.FullName)" }
        $stream = $entry.Open()
        $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
        try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($entry.FullName -ne 'INSTALAR.txt') {
            $original = [IO.File]::ReadAllText((Join-Path $projectRoot ('chrome-extension\' + $entry.FullName)))
            if ($body -cne $original) { throw "Conteúdo mudou ao empacotar: $($entry.FullName)" }
        }
        if ($entry.FullName -match '\.js$') {
            foreach ($match in [regex]::Matches($body, 'from\s+["'']\./([^"'']+)["'']')) {
                if ($entries -notcontains $match.Groups[1].Value) { throw "Módulo ausente no ZIP: $($match.Groups[1].Value)" }
            }
        }
        if ($entry.FullName -match '\.html$') {
            foreach ($match in [regex]::Matches($body, '(?:src|href)=["'']([^"'']+)["'']')) {
                if ($entries -notcontains $match.Groups[1].Value) { throw "Recurso ausente no ZIP: $($match.Groups[1].Value)" }
            }
        }
    }
} finally { $archive.Dispose() }
Write-Output 'OK: ZIP reinstalável, versão e dependências completas, sem dados pessoais.'

# Validar o encerramento em uma cópia isolada: PID com data diferente não pode ser encerrado.
$windowsFixture = Join-Path $fixtureRoot 'windows'
$runtime = Join-Path $fixtureRoot 'dist\windows\runtime'
New-Item -ItemType Directory -Path $windowsFixture, $runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'services.ps1') -Destination $windowsFixture
$kept = Start-Process powershell.exe -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
$stopped = Start-Process powershell.exe -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
try {
    @(
        @{name = 'external'; id = $kept.Id; started = $kept.StartTime.AddDays(-1).ToUniversalTime().ToString('o')},
        @{name = 'owned'; id = $stopped.Id; started = $stopped.StartTime.ToUniversalTime().ToString('o')}
    ) | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'processes.json') -Encoding UTF8
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $windowsFixture 'services.ps1') -Action stop
    if ($LASTEXITCODE -ne 0) { throw 'Falha no comando de encerramento.' }
    if (!(Get-Process -Id $kept.Id -ErrorAction SilentlyContinue)) { throw 'Encerrou processo com data de criação diferente.' }
    if (Get-Process -Id $stopped.Id -ErrorAction SilentlyContinue) { throw 'Não encerrou o processo pertencente ao painel.' }
    Write-Output 'OK: parada encerra processos próprios e preserva PID com data diferente.'
    '{}' | Set-Content -LiteralPath (Join-Path $fixtureRoot 'docker-compose.yml')
    $global:jobTrackerTestDatabaseOwner = $fixtureRoot
    $global:jobTrackerTestDockerStops = 0
    function docker.exe {
        $global:LASTEXITCODE = 0
        if ($args[0] -eq 'compose') { return ('a' * 64) }
        if ($args[0] -eq 'stop') { $global:jobTrackerTestDockerStops++; return }
        if ($args[0] -eq 'inspect' -and $args[-1] -eq '{{.State.Running}}') { return 'false' }
        if ($args[0] -eq 'inspect') { return (@{'com.docker.compose.project.working_dir' = $global:jobTrackerTestDatabaseOwner} | ConvertTo-Json -Compress) }
        throw 'Comando Docker inesperado no teste.'
    }
    & (Join-Path $windowsFixture 'services.ps1') -Action stop
    if ($LASTEXITCODE -ne 0 -or $jobTrackerTestDockerStops -ne 1) { throw 'O PostgreSQL Docker próprio não recebeu a parada.' }
    $global:jobTrackerTestDatabaseOwner = Join-Path $fixtureRoot 'outra-instalacao'
    & (Join-Path $windowsFixture 'services.ps1') -Action stop
    if ($LASTEXITCODE -ne 0 -or $jobTrackerTestDockerStops -ne 1) { throw 'Tentou parar um banco Docker de outra pasta.' }
    Remove-Item Function:docker.exe
    Write-Output 'OK: comandos Docker simulados param apenas o banco com a pasta exata e preservam outros bancos e volumes.'
} finally {
    foreach ($process in @($kept, $stopped)) {
        $process.Refresh()
        if (!$process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}

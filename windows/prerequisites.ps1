param([switch]$InstallMissing, [switch]$DefinitionsOnly, [switch]$StatusOnly)

function Update-JobTrackerPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = [Environment]::ExpandEnvironmentVariables("$machinePath;$userPath;$env:Path")
}

function Get-JobTrackerRequirements {
    $nodeReady = $false
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($node -and $npm) {
        try {
            $version = & $node.Source --version 2>$null
            $nodeReady = ($LASTEXITCODE -eq 0 -and "$version" -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22)
        } catch { $nodeReady = $false }
    }
    $vcReady = $false
    foreach ($key in @('HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')) {
        $runtime = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($runtime -and $runtime.Installed -eq 1 -and [version]($runtime.Version.TrimStart('v')) -ge [version]'14.44') { $vcReady = $true }
    }
    $webviewReady = $false
    foreach ($registryRoot in @('HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients')) {
        foreach ($key in Get-ChildItem -Path $registryRoot -ErrorAction SilentlyContinue) {
            $client = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($client.name -match 'WebView2' -and $client.pv -and $client.pv -ne '0.0.0.0') { $webviewReady = $true }
        }
    }
    return @{ nodeReady = $nodeReady; vcReady = $vcReady; webviewReady = $webviewReady; wingetReady = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue) }
}

function Invoke-JobTrackerPackage([ValidateSet('OpenJS.NodeJS.LTS', 'Microsoft.VCRedist.2015+.x64', 'Microsoft.EdgeWebView2Runtime')][string]$Id) {
    # O botão Instalar prepara automaticamente os requisitos ausentes. Identificadores exatos.
    & winget.exe install --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    $code = $LASTEXITCODE
    if ($code -eq 3010 -or $code -eq 1641 -or $code -eq -1978334967) {
        throw 'Um requisito pediu reinicialização. Reinicie o Windows e execute o instalador novamente. Não será reiniciado automaticamente.'
    }
    if ($code -ne 0) { throw "Não foi possível instalar $Id (código $code). Confira a internet, o pedido de administrador e as orientações do guia." }
}

function Ensure-JobTrackerRequirements([switch]$AllowInstall) {
    Update-JobTrackerPath
    $state = Get-JobTrackerRequirements
    $missing = @()
    if (!$state.nodeReady) { $missing += 'OpenJS.NodeJS.LTS' }
    if (!$state.vcReady) { $missing += 'Microsoft.VCRedist.2015+.x64' }
    if (!$state.webviewReady) { $missing += 'Microsoft.EdgeWebView2Runtime' }
    if ($missing.Count -eq 0) { Write-Output 'Node.js, Visual C++ e WebView2 encontrados. PostgreSQL já está incluído no Job Tracker.'; return }
    if (!$AllowInstall) { throw 'Faltam Node.js 22+, Visual C++ x64 ou WebView2. Execute o instalador para prepará-los automaticamente ou use os links do guia.' }
    if (!$state.wingetReady) { throw 'WinGet não está disponível. Instale ou atualize o Instalador de Aplicativo da Microsoft Store e execute novamente. O guia também contém os links oficiais de Node.js e Visual C++.' }
    foreach ($id in $missing) {
        Write-Output "Baixando e instalando requisito: $id. Autorize o Windows se houver pedido de administrador..."
        Invoke-JobTrackerPackage $id
        Update-JobTrackerPath
    }
    $state = Get-JobTrackerRequirements
    if (!$state.nodeReady -or !$state.vcReady -or !$state.webviewReady) { throw 'O Windows ainda não disponibilizou todos os requisitos. Reabra o instalador após concluir as instalações ou a reinicialização solicitada.' }
    Write-Output 'Requisitos prontos. O PostgreSQL privado dispensa Docker, WSL e virtualização.'
}

if (!$DefinitionsOnly) {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    if ($StatusOnly) { Update-JobTrackerPath; Get-JobTrackerRequirements | ConvertTo-Json -Compress }
    else { Ensure-JobTrackerRequirements -AllowInstall:$InstallMissing }
}

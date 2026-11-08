function New-JobTrackerShortcuts([string]$Root, [string]$Desktop = [Environment]::GetFolderPath('Desktop'), [string]$Menu = (Join-Path ([Environment]::GetFolderPath('Programs')) 'Job Tracker'), [switch]$SkipRegistration) {
    $shell = New-Object -ComObject WScript.Shell
    New-Item -ItemType Directory -Force -Path $Menu, $Desktop | Out-Null
    $application = Join-Path $Root 'dist\windows\JobTracker.exe'
    foreach ($path in @((Join-Path $Menu 'Job Tracker.lnk'), (Join-Path $Desktop 'Job Tracker.lnk'))) {
        $shortcut = $shell.CreateShortcut($path)
        $shortcut.TargetPath = $application
        $shortcut.WorkingDirectory = $Root
        $shortcut.IconLocation = $application + ',0'
        $shortcut.Description = 'Abrir o Job Tracker em janela própria'
        $shortcut.Save()
    }
    $shortcut = $shell.CreateShortcut((Join-Path $Menu 'Guia do Job Tracker.lnk'))
    $shortcut.TargetPath = $application
    $shortcut.Arguments = '--guide'
    $shortcut.WorkingDirectory = $Root
    $shortcut.Save()
    $shortcut = $shell.CreateShortcut((Join-Path $Menu 'Desinstalar Job Tracker.lnk'))
    $shortcut.TargetPath = Join-Path $Root 'Desinstalar Job Tracker.exe'
    $shortcut.WorkingDirectory = $Root
    $shortcut.Save()
    if ($SkipRegistration) { return }
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JobTracker'
    New-Item -Path $registry -Force | Out-Null
    foreach ($entry in @{
        DisplayName = 'Job Tracker'; Publisher = 'Job Tracker'; DisplayVersion = '0.3.6'; InstallLocation = $Root;
        UninstallString = ('"' + (Join-Path $Root 'Desinstalar Job Tracker.exe') + '"'); DisplayIcon = $application
    }.GetEnumerator()) { New-ItemProperty -Path $registry -Name $entry.Key -Value $entry.Value -PropertyType String -Force | Out-Null }
    New-ItemProperty -Path $registry -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $registry -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
}

# Write install launcher .cmd with CRLF (ASCII-only script)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$cmdName = (-join [char[]]@(0x4e00, 0x952e, 0x5b89, 0x88c5)) + ".cmd"
$cmdPath = Join-Path $ProjectRoot $cmdName
$lines = @(
    '@echo off'
    'cd /d "%~dp0"'
    'title AnyTLS'
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*'
    'exit /b %ERRORLEVEL%'
)
$content = ($lines -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($cmdPath, $content, [System.Text.Encoding]::ASCII)
Write-Host "Wrote cmd: $cmdPath"

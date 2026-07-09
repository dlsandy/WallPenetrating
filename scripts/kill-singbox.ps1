# Stop sing-box processes started by this extension
$ErrorActionPreference = "SilentlyContinue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $ProjectRoot "data\singbox.pid"
$ConfigPath = Join-Path $ProjectRoot "data\singbox-config.json"

function Get-ConfigPort {
    if (-not (Test-Path $ConfigPath)) { return 1080 }
    try {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        foreach ($inbound in $config.inbounds) {
            if ($inbound.listen_port) { return [int]$inbound.listen_port }
        }
    } catch { }
    return 1080
}

function Stop-SingboxOnPort([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -like "sing-box*") {
                taskkill /PID $proc.Id /T /F 2>$null | Out-Null
            }
        }
}

$port = Get-ConfigPort

if (Test-Path $PidFile) {
    $processId = Get-Content $PidFile
    if ($processId) {
        taskkill /PID $processId /T /F 2>$null | Out-Null
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-SingboxOnPort $port

Write-Host "sing-box on port $port stopped (if any)." -ForegroundColor Green

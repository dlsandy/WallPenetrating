# AnyTLS Native Messaging Host (PowerShell, no Node.js required)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $ProjectRoot "data"
$ConfigPath = Join-Path $DataDir "singbox-config.json"
$PidPath = Join-Path $DataDir "singbox.pid"
$HashPath = Join-Path $DataDir "singbox.hash"
$LogPath = Join-Path $DataDir "singbox.log"
$SingboxBin = Join-Path $ProjectRoot "bin\sing-box.exe"

function Write-Log([string]$Message) {
    [Console]::Error.WriteLine("[anytls-host] $Message")
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Read-Utf8Text([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return [System.Text.UTF8Encoding]::new($false).GetString($bytes, 3, $bytes.Length - 3)
    }
    return [System.Text.UTF8Encoding]::new($false).GetString($bytes)
}

function Send-NativeMessage($Object) {
    try {
        $json = $Object | ConvertTo-Json -Compress -Depth 20
    } catch {
        $json = '{"ok":false,"error":"JSON encode failed"}'
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $len = [BitConverter]::GetBytes([uint32]$bytes.Length)
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($len, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Strip-Ansi([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return "" }
    return [regex]::Replace($Text, "\x1b\[[0-9;]*m", "")
}

function Read-SharedFileBytes([string]$Path) {
    if (-not (Test-Path $Path)) { return @() }
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $ms = New-Object System.IO.MemoryStream
        $stream.CopyTo($ms)
        return $ms.ToArray()
    } finally {
        $stream.Dispose()
    }
}

function Decode-TextBytes([byte[]]$Bytes) {
    if (-not $Bytes -or $Bytes.Length -eq 0) { return "" }

    $offset = 0
    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
        $offset = 3
    }

    $length = $Bytes.Length - $offset
    if ($length -le 0) { return "" }

    $utf8Strict = New-Object System.Text.UTF8Encoding $false, $true
    try {
        return $utf8Strict.GetString($Bytes, $offset, $length)
    } catch {
        try {
            return [System.Text.Encoding]::GetEncoding(936).GetString($Bytes, $offset, $length)
        } catch {
            return [System.Text.Encoding]::UTF8.GetString($Bytes, $offset, $length)
        }
    }
}

function Decode-LogBytes([byte[]]$Bytes) {
    return (Strip-Ansi (Decode-TextBytes $Bytes)).Replace("`0", "")
}

function Read-LogText([string]$Path) {
    if (-not (Test-Path $Path)) { return "" }
    try {
        $bytes = Read-SharedFileBytes $Path
        return Decode-LogBytes $bytes
    } catch {
        Write-Log "shared read log failed: $($_.Exception.Message)"
        try {
            $raw = Get-Content -Path $Path -Raw -Encoding UTF8 -ErrorAction Stop
            return (Strip-Ansi $raw).Replace("`0", "")
        } catch {
            Write-Log "fallback read log failed: $($_.Exception.Message)"
            return ""
        }
    }
}

function Read-LogTail([int]$MaxLen = 800) {
    $text = Read-LogText $LogPath
    if (-not $text) { return "" }
    if ($text.Length -le $MaxLen) { return $text.TrimEnd() }
    return $text.Substring($text.Length - $MaxLen).TrimStart()
}

function Get-PortFromConfig($Config) {
    if (-not $Config) { return 1080 }
    foreach ($inbound in $Config.inbounds) {
        if ($inbound.listen_port) { return [int]$inbound.listen_port }
    }
    return 1080
}

function Find-ListeningPid([int]$Port) {
    $lines = netstat -ano -p tcp 2>$null
    foreach ($line in $lines) {
        if ($line -notmatch "LISTENING") { continue }
        if ($line -notmatch ":$Port\s") { continue }
        $parts = ($line -replace "\s+", " ").Trim().Split(" ")
        $listenPid = [int]$parts[-1]
        if ($listenPid -gt 0) { return $listenPid }
    }
    return $null
}

function Test-SingboxPid([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    return $proc.ProcessName -like "sing-box*"
}

function Test-ProcessRunning([int]$ProcessId) {
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    taskkill /PID $ProcessId /T /F 2>$null | Out-Null
}

function Clear-PidFiles() {
    Remove-Item $PidPath, $HashPath -Force -ErrorAction SilentlyContinue
}

function Read-SavedConfig() {
    if (-not (Test-Path $ConfigPath)) { return $null }
    try {
        $text = Read-Utf8Text $ConfigPath
        if (-not $text) { return $null }
        return $text | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Find-ActiveSingboxPid([int]$Port) {
    $portPid = Find-ListeningPid $Port
    if ($portPid -and (Test-SingboxPid $portPid)) { return $portPid }

    if (Test-Path $PidPath) {
        $tracked = [int](Get-Content $PidPath -Raw).Trim()
        if ((Test-ProcessRunning $tracked) -and (Test-SingboxPid $tracked)) { return $tracked }
    }
    return $null
}

function Release-Port([int]$Port) {
    $portPid = Find-ListeningPid $Port
    if ($portPid -and (Test-SingboxPid $portPid)) {
        Write-Log "release port $Port kill pid $portPid"
        Stop-ProcessTree $portPid
    }
    if (Test-Path $PidPath) {
        $tracked = [int](Get-Content $PidPath -Raw).Trim()
        if ((Test-ProcessRunning $tracked) -and $tracked -ne $portPid) {
            Stop-ProcessTree $tracked
        }
    }
    Clear-PidFiles
}

function Get-SingboxStatus() {
    $saved = Read-SavedConfig
    $port = Get-PortFromConfig $saved
    $activePid = Find-ActiveSingboxPid $port
    $running = [bool]$activePid

    if ($running) {
        New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
        Set-Content -Path $PidPath -Value $activePid -NoNewline
    }

    return @{
        ok           = $true
        running      = $running
        pid          = if ($running) { $activePid } else { $null }
        port         = $port
        binaryExists = Test-Path $SingboxBin
        binaryPath   = $SingboxBin
        configPath   = $ConfigPath
        logTail      = Read-LogTail 400
    }
}

function Start-SingboxProcess($Config, [string]$ConfigJson) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

    if (-not (Test-Path $SingboxBin)) {
        return @{
            ok           = $false
            error        = "sing-box not found at bin\sing-box.exe"
            binaryExists = $false
        }
    }

    $port = Get-PortFromConfig $Config
    $json = if ($ConfigJson) { $ConfigJson } else { $Config | ConvertTo-Json -Depth 20 }
    $hash = ([System.BitConverter]::ToString(
        [System.Security.Cryptography.SHA256]::Create().ComputeHash(
            [System.Text.Encoding]::UTF8.GetBytes($json)
        )
    )).Replace("-", "").ToLower()

    $activePid = Find-ActiveSingboxPid $port
    if ($activePid) {
        $sameConfig = $false
        if (Test-Path $HashPath) {
            $sameConfig = ((Get-Content $HashPath -Raw).Trim() -eq $hash)
        }
        if ($sameConfig) {
            Set-Content -Path $PidPath -Value $activePid -NoNewline
            return @{ ok = $true; running = $true; pid = $activePid; reused = $true; port = $port }
        }
        Release-Port $port
        Start-Sleep -Milliseconds 400
    }

    if (Find-ListeningPid $port) {
        return @{
            ok      = $false
            running = $false
            error   = "Port $port is in use; change the node local SOCKS port"
            log     = Read-LogTail
        }
    }

    Write-Utf8NoBom $ConfigPath $json
    Write-Utf8NoBom $HashPath $hash
    Write-Utf8NoBom $LogPath ""

    $proc = Start-Process -FilePath $SingboxBin `
        -ArgumentList @("run", "-c", $ConfigPath, "-D", $DataDir) `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardError $LogPath

    $procId = $proc.Id
    Set-Content -Path $PidPath -Value $procId -NoNewline
    Write-Log "started sing-box pid $procId port $port"

    Start-Sleep -Milliseconds 600

    if (-not (Test-ProcessRunning $procId)) {
        $logTail = Read-LogTail
        Clear-PidFiles
        $logText = if ($logTail) { $logTail } else { "no log output" }
        return @{
            ok      = $false
            running = $false
            error   = "sing-box exited immediately after start"
            log     = $logText
        }
    }

    return @{
        ok         = $true
        running    = $true
        pid        = $procId
        port       = $port
        configPath = $ConfigPath
    }
}

function Stop-SingboxProcess() {
    $saved = Read-SavedConfig
    $port = Get-PortFromConfig $saved
    Release-Port $port
    return @{ ok = $true; running = $false }
}

function Test-Connectivity($Msg) {
    $port = if ($Msg.port) { [int]$Msg.port } else { 1080 }
    $running = [bool](Find-ActiveSingboxPid $port)
    $proxyOk = $false
    $httpCode = ""
    $curlError = ""

    if ($running -and (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
        try {
            $httpCode = (curl.exe -s -o NUL -w "%{http_code}" --connect-timeout 12 -x "socks5h://127.0.0.1:$port" "https://www.gstatic.com/generate_204" 2>&1 | Out-String).Trim()
            $proxyOk = ($httpCode -eq "204")
        } catch {
            $curlError = $_.Exception.Message
        }
    }

    $remoteOk = $false
    $remoteMs = $null
    if ($Msg.remoteHost -and $Msg.remotePort) {
        try {
            $remotePort = [int]$Msg.remotePort
            $tn = Test-NetConnection -ComputerName $Msg.remoteHost -Port $remotePort -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
            $remoteOk = [bool]$tn.TcpTestSucceeded
            if ($tn.PingReplyDetails) {
                $remoteMs = [int]$tn.PingReplyDetails.RoundtripTime
            }
        } catch {
            $remoteOk = $false
        }
    }

    return @{
        ok        = $proxyOk
        running   = $running
        socksPort = $port
        proxyOk   = $proxyOk
        httpCode  = $httpCode
        curlError = $curlError
        remoteOk  = $remoteOk
        remoteMs  = $remoteMs
        message   = if ($proxyOk) { "SOCKS 代理可用" } elseif (-not $running) { "sing-box 未在端口 $port 运行" } else { "SOCKS 代理不可用 (HTTP $httpCode)" }
    }
}

function Get-RegisteredExtensionId() {
    $manifestPath = Join-Path $PSScriptRoot "com.anytls.singbox.json"
    $registeredId = $null

    if (Test-Path $manifestPath) {
        try {
            $json = Read-Utf8Text $manifestPath
            if ($json) {
                $manifest = $json | ConvertFrom-Json
                $origin = @($manifest.allowed_origins) | Select-Object -First 1
                if ($origin -match "chrome-extension://([a-p]{32})/") {
                    $registeredId = $Matches[1].ToLower()
                }
            }
        } catch {
            Write-Log "read manifest failed: $($_.Exception.Message)"
        }
    }

    if (-not $registeredId) {
        $savedPath = Join-Path $DataDir "extension-id.txt"
        if (Test-Path $savedPath) {
            $registeredId = (Get-Content $savedPath -Raw -ErrorAction SilentlyContinue).Trim().ToLower()
        }
    }

    return @{
        ok                    = $true
        registeredExtensionId = $registeredId
        manifestPath          = $manifestPath
    }
}

function Get-SingboxLogs($Msg) {
    $maxLen = 8000
    if ($Msg.maxLen) { $maxLen = [int]$Msg.maxLen }
    return @{
        ok  = $true
        log = Read-LogTail $maxLen
    }
}

function Clear-SingboxLogs() {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

    $saved = Read-SavedConfig
    $port = Get-PortFromConfig $saved
    $wasRunning = [bool](Find-ActiveSingboxPid $port)

    if ($wasRunning) {
        Release-Port $port
        Start-Sleep -Milliseconds 400
    }

    try {
        Write-Utf8NoBom $LogPath ""
    } catch {
        return @{
            ok    = $false
            error = "无法清空日志：$($_.Exception.Message)"
        }
    }

    $restarted = $false
    $restartError = $null

    if ($wasRunning -and $saved -and (Test-Path $ConfigPath)) {
        $configText = Read-Utf8Text $ConfigPath
        if ($configText) {
            $start = Start-SingboxProcess $saved $configText
            $restarted = [bool]$start.ok
            if (-not $start.ok) {
                $restartError = $start.error
            }
        }
    }

    return @{
        ok           = $true
        cleared      = $true
        wasRunning   = $wasRunning
        restarted    = $restarted
        restartError = $restartError
    }
}

function Get-SystemProxyStatus() {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    $enabled = $false
    $server = ""
    $autoConfig = ""
    $override = ""

    try {
        $props = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
        if ($props) {
            $enabled = ($props.ProxyEnable -eq 1)
            if ($props.ProxyServer) { $server = [string]$props.ProxyServer }
            if ($props.AutoConfigURL) { $autoConfig = [string]$props.AutoConfigURL }
            if ($props.ProxyOverride) { $override = [string]$props.ProxyOverride }
        }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }

    return @{
        ok         = $true
        enabled    = [bool]$enabled
        server     = $server
        autoConfig = $autoConfig
        override   = $override
    }
}

function Fetch-RemoteUrl($Msg) {
    $url = [string]$Msg.url
    if (-not $url) {
        return @{ ok = $false; error = "missing url" }
    }
    if ($url -notmatch '^https?://') {
        return @{ ok = $false; error = "only http(s) urls supported" }
    }
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
        return @{ ok = $false; error = "curl.exe not found" }
    }

    $maxBytes = 1048576
    $tmp = Join-Path $env:TEMP ("anytls-sub-" + [guid]::NewGuid().ToString("n") + ".txt")

    try {
        $httpCode = (
            curl.exe -s -L -o $tmp -w "%{http_code}" --connect-timeout 20 --max-time 45 $url 2>$null | Out-String
        ).Trim()

        if ($httpCode -notmatch '^2') {
            return @{ ok = $false; error = "HTTP $httpCode"; httpCode = $httpCode }
        }

        if (-not (Test-Path $tmp)) {
            return @{ ok = $false; error = "download failed"; httpCode = $httpCode }
        }

        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        if ($bytes.Length -gt $maxBytes) {
            return @{ ok = $false; error = "response too large (>1MB)"; httpCode = $httpCode }
        }

        $body = Decode-TextBytes $bytes
        return @{
            ok        = $true
            body      = $body
            httpCode  = $httpCode
            byteLength = $bytes.Length
        }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Open-SystemProxySettings() {
    try {
        Start-Process "ms-settings:network-proxy" | Out-Null
        return @{ ok = $true }
    } catch {
        try {
            Start-Process "inetcpl.cpl" | Out-Null
            return @{ ok = $true; fallback = $true }
        } catch {
            return @{ ok = $false; error = $_.Exception.Message }
        }
    }
}

function Handle-Message($Msg) {
    try {
        switch ($Msg.action) {
            "ping" { Send-NativeMessage @{ ok = $true; pong = $true; version = "2.9.0-ps" } }
            "status" { Send-NativeMessage (Get-SingboxStatus) }
            "start" { Send-NativeMessage (Start-SingboxProcess $Msg.config $Msg.configJson) }
            "stop" { Send-NativeMessage (Stop-SingboxProcess) }
            "test" { Send-NativeMessage (Test-Connectivity $Msg) }
            "logs" { Send-NativeMessage (Get-SingboxLogs $Msg) }
            "clear-logs" { Send-NativeMessage (Clear-SingboxLogs) }
            "registered" { Send-NativeMessage (Get-RegisteredExtensionId) }
            "system-proxy" { Send-NativeMessage (Get-SystemProxyStatus) }
            "fetch-url" { Send-NativeMessage (Fetch-RemoteUrl $Msg) }
            "open-system-proxy" { Send-NativeMessage (Open-SystemProxySettings) }
            default { Send-NativeMessage @{ ok = $false; error = "Unknown action: $($Msg.action)" } }
        }
    } catch {
        Send-NativeMessage @{ ok = $false; error = $_.Exception.Message }
    }
}

# Native messaging read loop
$stdin = [Console]::OpenStandardInput()
$pending = New-Object System.Collections.Generic.List[byte]

while ($true) {
    $chunk = New-Object byte[] 4096
    $read = $stdin.Read($chunk, 0, $chunk.Length)
    if ($read -le 0) { break }

    for ($i = 0; $i -lt $read; $i++) { [void]$pending.Add($chunk[$i]) }

    while ($pending.Count -ge 4) {
        $lenBytes = $pending.GetRange(0, 4).ToArray()
        $len = [BitConverter]::ToUInt32($lenBytes, 0)
        if ($pending.Count -lt (4 + $len)) { break }

        $bodyBytes = $pending.GetRange(4, $len).ToArray()
        $pending.RemoveRange(0, 4 + $len)

        $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes)
        try {
            $msg = $body | ConvertFrom-Json
            Handle-Message $msg
        } catch {
            Send-NativeMessage @{ ok = $false; error = "Invalid message: $($_.Exception.Message)" }
        }
    }
}

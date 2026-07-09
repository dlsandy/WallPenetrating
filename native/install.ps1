# 注册 Chrome Native Messaging Host
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\init-console-zh.ps1")

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$HostCmd = Join-Path $ProjectRoot "native\host.cmd"
$ManifestPath = Join-Path $ProjectRoot "native\com.anytls.singbox.json"
$SingboxBin = Join-Path $ProjectRoot "bin\sing-box.exe"

if (-not (Test-Path $HostCmd)) {
    Write-Error "未找到 native\host.cmd"
}

$manifestObj = @{
    name            = "com.anytls.singbox"
    description     = "AnyTLS sing-box runner"
    path            = $HostCmd
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifestObj | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.anytls.singbox"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value $ManifestPath

$SavedIdPath = Join-Path (Join-Path $ProjectRoot "data") "extension-id.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $SavedIdPath) | Out-Null
Set-Content -Path $SavedIdPath -Value $ExtensionId.ToLower() -NoNewline -Encoding UTF8

Write-Host "  [OK] Native Host 已注册" -ForegroundColor Green
Write-Host "       扩展 ID: $ExtensionId" -ForegroundColor DarkGray

if (Test-Path $SingboxBin) {
    Write-Host "  [OK] sing-box 已就绪" -ForegroundColor Green
} else {
    Write-Host "  [!] 未找到 sing-box" -ForegroundColor Yellow
}

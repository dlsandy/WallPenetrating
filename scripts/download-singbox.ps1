# Download sing-box to bin/sing-box.exe (pinned version; AnyTLS requires 1.12.0+)
param(
    [string]$Version = "1.13.14"
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\init-console-zh.ps1")

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $ProjectRoot "bin"
$Target = Join-Path $BinDir "sing-box.exe"
$VersionFile = Join-Path $BinDir "sing-box.version"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "正在下载 sing-box v$Version ..." -ForegroundColor Cyan

$tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/SagerNet/sing-box/releases/tags/$tag" -Headers @{
    "User-Agent" = "AnyTLS-Extension"
}

$asset = $release.assets | Where-Object { $_.name -match "windows-amd64\.zip$" } | Select-Object -First 1
if (-not $asset) {
    Write-Error "未找到 sing-box $tag 的 windows-amd64 安装包"
}

$zipPath = Join-Path $env:TEMP "sing-box-download.zip"
$extractDir = Join-Path $env:TEMP "sing-box-extract"

Write-Host "正在下载 $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing

if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$exe = Get-ChildItem -Path $extractDir -Recurse -Filter "sing-box.exe" | Select-Object -First 1
if (-not $exe) {
    Write-Error "压缩包中未找到 sing-box.exe"
}

Copy-Item $exe.FullName $Target -Force

$binSourceDir = $exe.Directory.FullName
foreach ($name in @("libcronet.dll", "LICENSE")) {
    $src = Join-Path $binSourceDir $name
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $BinDir $name) -Force
    }
}

Set-Content -Path $VersionFile -Value $tag -NoNewline -Encoding ASCII
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "已安装: $Target" -ForegroundColor Green
Write-Host "版本: $tag" -ForegroundColor Green

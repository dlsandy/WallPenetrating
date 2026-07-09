# AnyTLS 扩展安装向导
param(
    [string]$ExtensionId,
    [switch]$DownloadSingbox
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "scripts\init-console-zh.ps1")

try {
    $Host.UI.RawUI.WindowTitle = "AnyTLS 分流代理 - 安装向导"
} catch {
    # ignore
}

$ProjectRoot = $PSScriptRoot
$SingboxBin = Join-Path $ProjectRoot "bin\sing-box.exe"
$DataDir = Join-Path $ProjectRoot "data"
$SavedIdPath = Join-Path $DataDir "extension-id.txt"
$GuideHtml = Join-Path $ProjectRoot "开始使用.html"

function Write-Title([string]$Text) {
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host "  [!] $Text" -ForegroundColor Yellow
}

function Write-Err([string]$Text) {
    Write-Host "  [X] $Text" -ForegroundColor Red
}

function Test-ExtensionId([string]$Id) {
    return $Id -match '^[a-p]{32}$'
}

function Open-ChromeExtensions {
    $chromePaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $chromePaths) {
        if (Test-Path $path) {
            Start-Process $path "chrome://extensions"
            return $true
        }
    }
    try { Start-Process "chrome://extensions" } catch { }
    return $false
}

function Open-Guide {
    if (Test-Path $GuideHtml) {
        Start-Process $GuideHtml
    }
}

function Wait-Enter([string]$Prompt) {
    Read-Host $Prompt
}

try {
    Clear-Host
    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor White
    Write-Host "    AnyTLS 分流代理 - 安装向导" -ForegroundColor White
    Write-Host "  ========================================" -ForegroundColor White
    Write-Host ""
    Write-Host "  项目目录: $ProjectRoot" -ForegroundColor DarkGray

    Write-Title "[1/4] 检查 sing-box..."
    if ((Test-Path $SingboxBin) -and -not $DownloadSingbox) {
        $versionFile = Join-Path $ProjectRoot "bin\sing-box.version"
        $versionLabel = if (Test-Path $versionFile) { Get-Content $versionFile -Raw } else { "" }
        if ($versionLabel) {
            Write-Ok "已包含 sing-box ($versionLabel)"
        } else {
            Write-Ok "已包含 sing-box"
        }
    } elseif (-not (Test-Path $SingboxBin)) {
        Write-Warn "未找到 sing-box，正在下载..."
        & (Join-Path $ProjectRoot "scripts\download-singbox.ps1")
    } else {
        Write-Warn "正在重新下载 sing-box..."
        & (Join-Path $ProjectRoot "scripts\download-singbox.ps1")
    }

    Write-Title "[2/4] 准备数据目录..."
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    Write-Ok "data 目录已就绪"

    Write-Title "[3/4] 加载 Chrome 扩展..."
    try {
        Set-Clipboard -Value $ProjectRoot
        Write-Ok "项目路径已复制到剪贴板"
    } catch {
        Write-Warn "无法复制到剪贴板，请手动选择文件夹"
    }

    Write-Host ""
    Write-Host "  请按以下步骤操作:" -ForegroundColor Yellow
    Write-Host "  1) 打开 chrome://extensions"
    Write-Host "  2) 开启「开发者模式」"
    Write-Host "  3) 点击「加载已解压的扩展程序」"
    Write-Host "  4) 选择本文件夹:"
    Write-Host "     $ProjectRoot" -ForegroundColor Gray
    Write-Host ""
    Wait-Enter "加载扩展完成后，按 Enter 继续"

    Open-ChromeExtensions | Out-Null
    Start-Sleep -Seconds 1

    Write-Title "[4/4] 注册 Native Host..."

    if (-not $ExtensionId -and (Test-Path $SavedIdPath)) {
        $savedId = (Get-Content $SavedIdPath -Raw).Trim().ToLower()
        if (Test-ExtensionId $savedId) {
            Write-Host ""
            Write-Host "  已保存的扩展 ID: $savedId" -ForegroundColor DarkGray
            $answer = Read-Host "  使用已保存的 ID？(Y/n)"
            if ($answer -eq "" -or $answer -match '^[Yy]') {
                $ExtensionId = $savedId
            }
        }
    }

    if (-not $ExtensionId) {
        Write-Host ""
        Write-Host "  请从 chrome://extensions 页面复制扩展 ID" -ForegroundColor Yellow
        Write-Host "  （32 位小写字母，例如 lmdaldjfmgfopjefknoepcodejbihabb）" -ForegroundColor Yellow
        Write-Host ""
        $ExtensionId = Read-Host "  粘贴扩展 ID"
    }

    $ExtensionId = $ExtensionId.Trim().ToLower()
    if (-not (Test-ExtensionId $ExtensionId)) {
        Write-Err "扩展 ID 格式无效"
        Wait-Enter "按 Enter 退出"
        exit 1
    }

& (Join-Path $ProjectRoot "native\install.ps1") -ExtensionId $ExtensionId
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Set-Content -Path $SavedIdPath -Value $ExtensionId -NoNewline -Encoding UTF8

    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host "    安装完成！" -ForegroundColor Green
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  接下来:" -ForegroundColor Cyan
    Write-Host "  1) 在扩展弹窗中添加 AnyTLS 节点"
    Write-Host "  2) 添加网址规则（如 google.com）"
    Write-Host "  3) 打开分流开关"
    Write-Host ""
    Open-Guide
    Wait-Enter "按 Enter 关闭，完成安装"
    exit 0
}
catch {
    Write-Host ""
    Write-Err $_.Exception.Message
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    Wait-Enter "按 Enter 退出"
    exit 1
}

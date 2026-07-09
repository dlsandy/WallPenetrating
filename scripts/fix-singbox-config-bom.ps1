# Fix singbox-config.json UTF-8 BOM (ASCII-only script)
$ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) "data\singbox-config.json"
$HashPath = Join-Path (Split-Path -Parent $PSScriptRoot) "data\singbox.hash"

if (-not (Test-Path $ConfigPath)) {
    Write-Host "No config to fix"
    exit 0
}

$bytes = [System.IO.File]::ReadAllBytes($ConfigPath)
$start = 0
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $start = 3
}
$text = [System.Text.UTF8Encoding]::new($false).GetString($bytes, $start, $bytes.Length - $start)
[System.IO.File]::WriteAllText($ConfigPath, $text, [System.Text.UTF8Encoding]::new($false))
Remove-Item $HashPath -Force -ErrorAction SilentlyContinue
Write-Host "Fixed: $ConfigPath"

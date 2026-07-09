# Generate solid-color extension icons (no external image required)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $ProjectRoot "icons"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Add-Type -AssemblyName System.Drawing
$color = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)

foreach ($size in 16, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear($color)
    $out = Join-Path $Dest "icon$size.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

Write-Host "Icons written to $Dest"

# Setup sing-box integration (legacy entry, calls root installer)
param(
    [string]$ExtensionId
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $ProjectRoot "install.ps1") @PSBoundParameters

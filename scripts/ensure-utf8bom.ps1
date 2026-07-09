# Re-save PowerShell scripts as UTF-8 with BOM (required for Chinese on Windows PowerShell 5.1)
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Paths
)

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$utf8Bom = [System.Text.UTF8Encoding]::new($true)

foreach ($path in $Paths) {
    if (-not (Test-Path $path)) {
        Write-Error "File not found: $path"
    }
    $text = [System.IO.File]::ReadAllText($path, $utf8NoBom)
    [System.IO.File]::WriteAllText($path, $text, $utf8Bom)
    Write-Host "BOM OK: $path"
}

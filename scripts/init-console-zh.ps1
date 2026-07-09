# Match console output to system locale (GBK on Chinese Windows, UTF-8 otherwise)
try {
    $ansiCp = [System.Text.Encoding]::Default.CodePage
    if ($ansiCp -eq 936) {
        cmd /c "chcp 936>nul"
        $enc = [System.Text.Encoding]::GetEncoding(936)
    } else {
        cmd /c "chcp 65001>nul"
        $enc = [System.Text.Encoding]::UTF8
    }
    [Console]::OutputEncoding = $enc
    [Console]::InputEncoding = $enc
    $global:OutputEncoding = $enc
} catch {
    # ignore
}

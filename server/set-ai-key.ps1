# Подключить бесплатный ИИ для голосовых команд (Google Gemini, бесплатный тариф) — для PowerShell.
# Ключ: https://aistudio.google.com/apikey → Create API key (бесплатно, без карты). Ввод скрыт.
#   powershell -ExecutionPolicy Bypass -File server\set-ai-key.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$secure = Read-Host -Prompt 'Ключ Gemini (AIza..., ввод скрыт)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = $key.Trim()
if (-not $key) { Write-Host 'Ключ пустой - отмена'; exit 1 }

# ключ проверяем сразу у Google, до выкладки
try {
  $null = Invoke-RestMethod -Method Get -Uri "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1" -Headers @{ 'x-goog-api-key' = $key }
  Write-Host 'Ключ рабочий.' -ForegroundColor Green
} catch {
  Write-Host 'Google не принял ключ - проверьте, что скопировали его целиком.' -ForegroundColor Yellow
  exit 1
}

# neon может не быть в PATH этого терминала — ищем в глобальных папках npm, иначе через npx
$neon = (Get-Command neon -ErrorAction SilentlyContinue).Source
$cands = @()
if ($env:APPDATA) { $cands += (Join-Path $env:APPDATA 'npm/neon.cmd') }
$cands += 'C:/Users/Ернар/AppData/Roaming/npm/neon.cmd'
$cands += @(Get-ChildItem 'C:/Users/*/AppData/Roaming/npm/neon.cmd' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
if (-not $neon) { $neon = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1 }
$prefix = @()
if (-not $neon) {
  $npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npx) { $npx = (Get-Command npx -ErrorAction SilentlyContinue).Source }
  if (-not $npx -and (Test-Path -LiteralPath 'C:/Program Files/nodejs/npx.cmd')) { $npx = 'C:/Program Files/nodejs/npx.cmd' }
  if (-not $npx) { Write-Host "Не найден Neon CLI. APPDATA=$env:APPDATA"; exit 1 }
  $neon = $npx
  $prefix = @('--yes', 'neonctl@7.0.6')
}
Write-Host "Neon CLI: $neon"

# --env обновляет только эту переменную: почта (BREVO_API_KEY и др.) остаётся
& $neon @prefix functions deploy supermind --src src/index.ts `
  --project-id summer-math-35594657 --branch br-soft-term-b1xn6yim `
  --env "GEMINI_API_KEY=$key"
$code = $LASTEXITCODE
Remove-Variable key
if ($code -ne 0) { Write-Host "Выкладка не удалась (код $code)"; exit $code }

Write-Host ''
Write-Host 'ИИ подключён. Напишите в чат «готово» — я проверю.' -ForegroundColor Green

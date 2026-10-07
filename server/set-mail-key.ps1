# Подключить отправку писем (восстановление пароля) — для PowerShell.
# Спрашивает ключ Brevo (ввод скрыт) и адрес отправителя, затем выкладывает сервер с этими переменными.
#   powershell -ExecutionPolicy Bypass -File server\set-mail-key.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$secure = Read-Host -Prompt 'Ключ Brevo (xkeysib-..., ввод скрыт)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = $key.Trim()
if (-not $key) { Write-Host 'Ключ пустой - отмена'; exit 1 }

$from = Read-Host -Prompt 'Адрес отправителя, подтверждённый в Brevo [edamkaldybek@gmail.com]'
if (-not $from) { $from = 'edamkaldybek@gmail.com' }

& neon functions deploy supermind --src src/index.ts `
  --project-id summer-math-35594657 --branch br-soft-term-b1xn6yim `
  --env "BREVO_API_KEY=$key" --env "MAIL_FROM=$from" --env "MAIL_NAME=SuperMind"
$code = $LASTEXITCODE
Remove-Variable key
if ($code -ne 0) { Write-Host "Выкладка не удалась (код $code)"; exit $code }

Write-Host ''
Write-Host 'Проверка (письмо не отправляется):'
$r = $null
try {
  $r = Invoke-RestMethod -Method Post -Uri 'https://br-soft-term-b1xn6yim-supermind.compute.c-5.eu-central-1.aws.neon.tech/auth/forgot' `
    -ContentType 'application/json' -Body '{"email":"nobody@example.test"}'
} catch { }
if ($r -and $r.ok) { Write-Host 'Почта подключена. Попробуйте «Забыли пароль?» в приложении.' -ForegroundColor Green }
else { Write-Host 'Сервер ещё не видит ключ - напишите об этом в чат.' -ForegroundColor Yellow }

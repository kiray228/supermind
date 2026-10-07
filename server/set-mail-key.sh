#!/usr/bin/env bash
# Подключить отправку писем (восстановление пароля): спрашивает ключ Brevo и адрес отправителя,
# затем выкладывает сервер с этими переменными. Ключ не сохраняется в файлах и не выводится на экран.
#   bash server/set-mail-key.sh
set -euo pipefail
cd "$(dirname "$0")"

read -r -s -p "Ключ Brevo (xkeysib-…, ввод скрыт): " KEY
echo
if [[ -z "$KEY" ]]; then echo "Ключ пустой — отмена"; exit 1; fi
read -r -p "Адрес отправителя, подтверждённый в Brevo [edamkaldybek@gmail.com]: " FROM
FROM=${FROM:-edamkaldybek@gmail.com}

neon functions deploy supermind --src src/index.ts \
  --project-id summer-math-35594657 --branch br-soft-term-b1xn6yim \
  --env "BREVO_API_KEY=$KEY" --env "MAIL_FROM=$FROM" --env "MAIL_NAME=SuperMind"
unset KEY

echo
echo "Проверка: запрос кода для несуществующего адреса (письмо не отправляется)…"
curl -s -X POST https://br-soft-term-b1xn6yim-supermind.compute.c-5.eu-central-1.aws.neon.tech/auth/forgot \
  -H 'Content-Type: application/json' -d '{"email":"nobody@example.test"}'
echo
echo 'Если выше {"ok":true} — почта подключена. Попробуйте «Забыли пароль?» в приложении.'

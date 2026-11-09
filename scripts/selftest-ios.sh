#!/usr/bin/env bash
# Самопроверка на симуляторе iPhone (CI): установить тестовую сборку, запустить, снимать экраны
# по сигналу приложения («SMTEST {"kind":"shot"…}»), перезапустить и прогнать второй раз (данные сохранились?).
# Использование: scripts/selftest-ios.sh путь/к/App.app [папка-результатов]
set -uo pipefail
APP="$1"
OUT="${2:-selftest-out}"
BUNDLE=app.twomind.mindmap
mkdir -p "$OUT/shots"

# iPhone поновее из установленных симуляторов
UDID=$(xcrun simctl list devices available | grep -E '^\s+iPhone' | grep -m1 ' Pro (' | grep -oE '[0-9A-F-]{36}')
[ -z "$UDID" ] && UDID=$(xcrun simctl list devices available | grep -E '^\s+iPhone' | grep -m1 -oE '[0-9A-F-]{36}')
echo "Симулятор: $(xcrun simctl list devices | grep "$UDID" | sed 's/^ *//')"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP"
# микрофон, распознавание речи, фото — заранее, иначе системные окна закроют экран
xcrun simctl privacy "$UDID" grant all "$BUNDLE" 2>/dev/null || true

field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$2"; }

run_phase() {
  local n=$1 log="$OUT/ios-phase$1.log" seen=0 deadline=$((SECONDS + 600))
  : >"$log"
  xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" >"$log" 2>&1 &
  local pid=$!
  while ((SECONDS < deadline)); do
    mapfile -t lines < <(grep -o 'SMTEST {.*}' "$log" | tail -n +$((seen + 1)))
    for l in "${lines[@]}"; do
      seen=$((seen + 1))
      local json=${l#SMTEST } kind
      kind=$(field kind "$json")
      if [ "$kind" = shot ]; then
        xcrun simctl io "$UDID" screenshot "$OUT/shots/ios-$n-$(printf %02d "$seen")-$(field name "$json").png" >/dev/null 2>&1
      elif [ "$kind" = done ]; then
        kill "$pid" 2>/dev/null
        return 0
      fi
    done
    sleep 0.5
  done
  echo "::error::Самопроверка iOS, запуск $n: не закончилась за 10 минут"
  xcrun simctl io "$UDID" screenshot "$OUT/shots/ios-$n-timeout.png" >/dev/null 2>&1
  kill "$pid" 2>/dev/null
  return 1
}

run_phase 1
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
sleep 2
run_phase 2
exit 0

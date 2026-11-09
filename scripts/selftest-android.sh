#!/usr/bin/env bash
# Самопроверка на эмуляторе Android (CI): то же, что scripts/selftest-ios.sh, но через adb.
# Использование: scripts/selftest-android.sh путь/к/app-debug.apk [папка-результатов]
set -uo pipefail
APK="$1"
OUT="${2:-selftest-out}"
BUNDLE=app.twomind.mindmap
mkdir -p "$OUT/shots"

adb wait-for-device
adb install -r "$APK"
# разрешения заранее — иначе системные окна закроют экран
for p in POST_NOTIFICATIONS RECORD_AUDIO READ_CALENDAR WRITE_CALENDAR; do
  adb shell pm grant "$BUNDLE" "android.permission.$p" 2>/dev/null || true
done

field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$2"; }

run_phase() {
  local n=$1 log="$OUT/android-phase$1.log" seen=0 deadline=$((SECONDS + 600))
  adb logcat -c
  adb logcat -v brief >"$log" 2>&1 &
  local logpid=$!
  adb shell monkey -p "$BUNDLE" -c android.intent.category.LAUNCHER 1 >/dev/null
  while ((SECONDS < deadline)); do
    # без mapfile: на macOS старый bash 3.2
    while IFS= read -r l; do
      seen=$((seen + 1))
      local json=${l#SMTEST } kind
      kind=$(field kind "$json")
      if [ "$kind" = shot ]; then
        adb exec-out screencap -p >"$OUT/shots/android-$n-$(printf %02d "$seen")-$(field name "$json").png"
      elif [ "$kind" = done ]; then
        kill "$logpid" 2>/dev/null
        return 0
      fi
    done < <(grep -o 'SMTEST {.*}' "$log" | tail -n +$((seen + 1)))
    sleep 0.5
  done
  echo "::error::Самопроверка Android, запуск $n: не закончилась за 10 минут"
  adb exec-out screencap -p >"$OUT/shots/android-$n-timeout.png"
  kill "$logpid" 2>/dev/null
  return 1
}

run_phase 1
sleep 3
adb shell am force-stop "$BUNDLE"
sleep 2
run_phase 2
exit 0

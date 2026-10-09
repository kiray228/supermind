; Прежняя версия SuperMind (на Electron, 100+ МБ) стояла в другой папке.
; Удаляем её перед установкой, чтобы у пользователя не оказалось двух программ и двух ярлыков.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$LOCALAPPDATA\Programs\supermind-desktop\Uninstall SuperMind.exe" 0 +3
    ExecWait '"$LOCALAPPDATA\Programs\supermind-desktop\Uninstall SuperMind.exe" /S /currentuser _?=$LOCALAPPDATA\Programs\supermind-desktop'
    RMDir /r "$LOCALAPPDATA\Programs\supermind-desktop"
!macroend

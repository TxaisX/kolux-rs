; T-574, T-578: the installer no longer installs the coding agents. People pick the ones they want when Kolux
; opens (first-run wizard and Settings > Agents), and Kolux installs just those, several at once.
; This file stays because tauri.conf.json points at it.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Pick your coding agents when Kolux opens"
!macroend

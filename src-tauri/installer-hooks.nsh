; T-574: after the files are in place, install the coding agents (and the runtimes they need).
; Runs for silent installs (/S) too: DetailPrint is simply not shown there. The result is ignored on
; purpose: a failed agent install must never fail the Kolux install (it is in kolux.log either way).
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing coding agents (this can take a few minutes)"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --install-agents' $0
  DetailPrint "Coding agents step finished (code $0)"
!macroend

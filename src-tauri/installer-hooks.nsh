; T-574: after the files are in place, install the coding agents (and the runtimes they need).
; T-576:
;  - An update ($UpdateMode, the /UPDATE switch the Tauri template reads) never re-runs the agent installs.
;  - An interactive install (not /S, not passive /P) passes --interactive: a runtime install (Node.js, Git) may
;    raise Windows' admin prompt, and the detail text says so first. A silent or passive install passes nothing:
;    the run then never starts a machine-wide runtime install and logs "needs Node.js (...)" instead.
; The result is ignored on purpose: a failed agent install must never fail the Kolux install (it is in kolux.log either way).
!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode = 1
    DetailPrint "Update: coding agents are left as they are"
  ${Else}
    StrCpy $R9 ""
    ${IfNot} ${Silent}
    ${AndIf} $PassiveMode <> 1
      StrCpy $R9 " --interactive"
      DetailPrint "Installing Node.js / Git: Windows may ask for permission"
    ${EndIf}
    DetailPrint "Installing coding agents (this can take a few minutes)"
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --install-agents$R9' $0
    DetailPrint "Coding agents step finished (code $0)"
  ${EndIf}
!macroend

; T-594 evidence: compiles src-tauri/installer-hooks.nsh the way Tauri's NSIS template uses it (same headers
; first, the hooks file included, NSIS_HOOK_POSTINSTALL in the install section, NSIS_HOOK_PREUNINSTALL at the
; start and NSIS_HOOK_POSTUNINSTALL at the end of the uninstall section, MAINBINARYNAME defined as the template
; defines it), so makensis proves the syntax. It is never run.
; Run from anywhere: makensis -WX -DOUT=<scratch>/hooks-check.exe evidence/T-594-hooks-check.nsi
; -DALONE=1 includes the hooks file with no other header first.
!ifndef OUT
  !error "pass -DOUT=<file> so the test installer lands in a scratch folder"
!endif
Unicode true
!define MAINBINARYNAME "kolux-rs"
!ifndef ALONE
  !include FileFunc.nsh
  !include x64.nsh
  !include WordFunc.nsh
  !include StrFunc.nsh
!endif
!include "..\src-tauri\installer-hooks.nsh"
Name "Kolux RS hooks check"
OutFile "${OUT}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Kolux RS"

Section Install
  SetOutPath "$INSTDIR"
  !insertmacro NSIS_HOOK_POSTINSTALL
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section Uninstall
  !insertmacro NSIS_HOOK_PREUNINSTALL
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd

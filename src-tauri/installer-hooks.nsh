; T-574, T-578: the installer no longer installs the coding agents. People pick the ones they want when Kolux
; opens (first-run wizard and Settings > Agents), and Kolux installs just those, several at once.
; T-594 (CLI-007): a new terminal finds kolux. The installer puts the install's bin folder (kolux.exe and
; kolux.cmd, DT-R27) on the user's PATH when it is missing, and the uninstaller takes exactly that entry off
; again. The rules are cli_register.rs's (CLI-008): the variable keeps its name and stays REG_EXPAND_SZ, the
; change is read back before it is reported, and no other entry is ever touched.
; ponytail: NSIS strings hold 1024 characters, so a PATH too long to change safely is left as it is and the
; log says so (Settings > CLI > Register has no such limit); upgrade: read and write the value through the
; System plugin into a buffer of its own size.
!include LogicLib.nsh
!include WinMessages.nsh

; The longest string NSIS holds, its terminating zero left out.
!define /math KOLUX_STRLEN_MAX ${NSIS_MAX_STRLEN} - 1

; $R9: the name the PATH variable goes by in HKCU\Environment (Path, PATH, ...), or "" when there is none.
!macro KOLUX_PATH_NAME
  StrCpy $R9 ""
  StrCpy $R8 0
  ${Do}
    ClearErrors
    EnumRegValue $R7 HKCU "Environment" $R8
    ${If} ${Errors}
    ${OrIf} $R7 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R7 == "Path"
      StrCpy $R9 $R7
      ${ExitDo}
    ${EndIf}
    IntOp $R8 $R8 + 1
  ${Loop}
!macroend

; $R2: the PATH text in $R8 without its entries that are $INSTDIR\bin (any case, with or without a trailing
; \); $R6: how many there were. Every other entry, empty ones too, stays as it was and where it was.
!macro KOLUX_PATH_CUT
  StrCpy $R2 ""
  StrCpy $R3 ""
  StrCpy $R4 0
  StrCpy $R6 0
  StrCpy $R7 0
  ${Do}
    StrCpy $R5 $R8 1 $R4
    ${If} $R5 == ";"
    ${OrIf} $R5 == ""
      ${If} $R3 == "$INSTDIR\bin"
      ${OrIf} $R3 == "$INSTDIR\bin\"
        IntOp $R6 $R6 + 1
      ${ElseIf} $R7 = 0
        StrCpy $R2 $R3
        StrCpy $R7 1
      ${Else}
        StrCpy $R2 "$R2;$R3"
      ${EndIf}
      StrCpy $R3 ""
      ${If} $R5 == ""
        ${ExitDo}
      ${EndIf}
    ${Else}
      StrCpy $R3 "$R3$R5"
    ${EndIf}
    IntOp $R4 $R4 + 1
  ${Loop}
!macroend

!macro KOLUX_SAVE
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
!macroend

!macro KOLUX_RESTORE
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro KOLUX_PATH_ADD
  !insertmacro KOLUX_SAVE
  ${If} ${FileExists} "$INSTDIR\bin\kolux.exe"
    !insertmacro KOLUX_PATH_NAME
    StrCpy $R0 ""
    ClearErrors
    ${If} $R9 == ""
      StrCpy $R9 "Path"
    ${Else}
      ReadRegStr $R0 HKCU "Environment" $R9
    ${EndIf}
    ${If} ${Errors}
      DetailPrint "Your PATH was left as it is: it is too long for the installer to change safely. Settings > CLI > Register adds kolux."
    ${Else}
      ; ponytail: only the plain spelling counts as there, so an entry the user wrote with %VARIABLES% gets
      ; a second, plain one beside it (harmless); upgrade: compare through ExpandEnvironmentStrings.
      StrCpy $R8 $R0
      !insertmacro KOLUX_PATH_CUT
      ${If} $R6 > 0
        DetailPrint "$INSTDIR\bin is already on your PATH"
      ${Else}
        ; Trailing separators go first, as cli_register's path_with does.
        StrCpy $R1 $R0
        ${Do}
          StrCpy $R5 $R1 1 -1
          ${If} $R5 != ";"
            ${ExitDo}
          ${EndIf}
          StrCpy $R1 $R1 -1
        ${Loop}
        StrLen $R3 $R1
        StrLen $R4 "$INSTDIR\bin"
        IntOp $R3 $R3 + $R4
        ${If} $R3 >= ${KOLUX_STRLEN_MAX}
          DetailPrint "Your PATH was left as it is: it is too long for the installer to change safely. Settings > CLI > Register adds kolux."
        ${Else}
          ${If} $R1 == ""
            StrCpy $R1 "$INSTDIR\bin"
          ${Else}
            StrCpy $R1 "$R1;$INSTDIR\bin"
          ${EndIf}
          ClearErrors
          WriteRegExpandStr HKCU "Environment" $R9 $R1
          ${If} ${Errors}
            DetailPrint "Windows refused the change to your PATH. Settings > CLI > Register adds kolux."
          ${Else}
            ClearErrors
            ReadRegStr $R8 HKCU "Environment" $R9
            ${If} ${Errors}
              DetailPrint "The change to your PATH could not be checked afterwards"
            ${Else}
              !insertmacro KOLUX_PATH_CUT
              ${If} $R6 > 0
                DetailPrint "Added $INSTDIR\bin to your PATH: new terminals find kolux"
              ${Else}
                DetailPrint "$INSTDIR\bin is still not on your PATH after the change; something else holds that setting"
              ${EndIf}
            ${EndIf}
            SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=2000
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro KOLUX_RESTORE
!macroend

!macro KOLUX_PATH_REMOVE
  !insertmacro KOLUX_SAVE
  !insertmacro KOLUX_PATH_NAME
  ${If} $R9 != ""
    ClearErrors
    ReadRegStr $R8 HKCU "Environment" $R9
    ${If} ${Errors}
      DetailPrint "Your PATH was left as it is: it is too long for the uninstaller to change safely. Remove $INSTDIR\bin from it in Windows settings."
    ${Else}
      !insertmacro KOLUX_PATH_CUT
      ${If} $R6 > 0
        ClearErrors
        WriteRegExpandStr HKCU "Environment" $R9 $R2
        ${If} ${Errors}
          DetailPrint "Windows refused the change to your PATH; $INSTDIR\bin is still on it"
        ${Else}
          ClearErrors
          ReadRegStr $R8 HKCU "Environment" $R9
          ${If} ${Errors}
            DetailPrint "The change to your PATH could not be checked afterwards"
          ${Else}
            !insertmacro KOLUX_PATH_CUT
            ${If} $R6 > 0
              DetailPrint "$INSTDIR\bin is still on your PATH after the change"
            ${Else}
              DetailPrint "Took $INSTDIR\bin off your PATH"
            ${EndIf}
          ${EndIf}
          SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=2000
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro KOLUX_RESTORE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Pick your coding agents when Kolux opens"
  !insertmacro KOLUX_PATH_ADD
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro KOLUX_PATH_REMOVE
!macroend

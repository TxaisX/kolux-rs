@echo off
rem CLI-006: kolux.cmd hands every call to the kolux.exe beside it and returns its exit status.
setlocal
set "KOLUX_EXE=%~dp0kolux.exe"
if not exist "%KOLUX_EXE%" goto missing
if /i not "%~1"=="orchestration" goto run
if /i "%~2"=="send" goto refuse
if /i "%~2"=="reply" goto refuse
:run
"%KOLUX_EXE%" %*
exit /b %ERRORLEVEL%
:missing
>&2 echo error: kolux.exe is missing from the folder of kolux.cmd; reinstall Kolux.
exit /b 1
:refuse
>&2 echo error: kolux.cmd declines orchestration %~2, because cmd reads the arguments a second time and can run or cut short line breaks in a message body. Run kolux.exe orchestration %~2 instead.
exit /b 2

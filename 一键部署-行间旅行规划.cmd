@echo off
rem ASCII-only launcher. Keep this file free of non-ASCII text and of chcp:
rem switching the console code page inside a batch file makes cmd re-read the file
rem from a stale byte offset, which turns later lines into commands and breaks
rem "call :label". All logic and Chinese output live in deploy.ps1 (UTF-8 BOM).
setlocal EnableDelayedExpansion
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "ARGS="
for %%a in (%*) do (
  if /i "%%a"=="--lan" (
    set "ARGS=!ARGS! -Lan"
  ) else (
    set "ARGS=!ARGS! %%a"
  )
)
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %ARGS%
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%

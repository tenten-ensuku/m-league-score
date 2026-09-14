@echo off
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%PATH%;%NODE_PATH%"
cd /d "%~dp0"

echo ====================================
echo   M-League Score Updater
echo ====================================
echo.

"%NODE_PATH%\node.exe" --version > nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Node.js not found at %NODE_PATH%
  pause
  exit /b 1
)

call npm.cmd ci
if %errorlevel% neq 0 exit /b 1
call npm.cmd run check
if %errorlevel% neq 0 exit /b 1
"%NODE_PATH%\node.exe" scrape.js

if %errorlevel% == 0 (
  echo.
  echo Opening dist\index.html ...
  start "" "%~dp0dist\index.html"
) else (
  echo.
  echo [ERROR] scrape.js failed.
)

echo.
pause

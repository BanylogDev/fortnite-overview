@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "ENGINE_DIR=%PROJECT_DIR%Engine"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ENGINE_DIR%\Code\ensureNpm.ps1"
if errorlevel 1 (
    echo.
    echo Could not set up Node.js and npm. Check your internet connection and try again.
    pause
    exit /b 1
)

if exist "%ENGINE_DIR%\Runtime\node.exe" set "PATH=%ENGINE_DIR%\Runtime;%PATH%"
cd /d "%ENGINE_DIR%"
node Code\main.js
pause

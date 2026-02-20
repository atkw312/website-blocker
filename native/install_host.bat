@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Focus Blocker — Native Messaging Setup
echo ============================================
echo.

:: Prompt for Chrome extension ID
set /p EXT_ID="Enter your Chrome extension ID: "
if "%EXT_ID%"=="" (
    echo ERROR: Extension ID cannot be empty.
    exit /b 1
)

:: Resolve paths
set "SCRIPT_DIR=%~dp0"
set "EXE_PATH=%SCRIPT_DIR%target\release\focus-blocker-native.exe"
set "MANIFEST_PATH=%SCRIPT_DIR%com.focusblocker.native.json"

:: Check that the exe exists
if not exist "%EXE_PATH%" (
    echo ERROR: Native app not found at:
    echo   %EXE_PATH%
    echo.
    echo Build it first with: cargo build --release
    exit /b 1
)

:: Convert backslashes to double-backslashes for JSON
set "JSON_EXE_PATH=%EXE_PATH:\=\\%"

:: Write the native messaging host manifest
echo Writing manifest to: %MANIFEST_PATH%
(
echo {
echo   "name": "com.focusblocker.native",
echo   "description": "Focus Blocker native enforcement agent",
echo   "path": "%JSON_EXE_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: Register in Windows registry
echo Registering native messaging host in registry...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.focusblocker.native" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% neq 0 (
    echo ERROR: Failed to write registry key.
    exit /b 1
)

:: Register auto-launch on Windows startup (restore mode)
echo Registering startup entry for restore mode...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FocusBlockerNative" /t REG_SZ /d "\"%EXE_PATH%\" restore" /f

if %errorlevel% neq 0 (
    echo WARNING: Failed to register startup entry. Auto-restore on reboot will not work.
)

echo.
echo Done! Native messaging host registered successfully.
echo.
echo   Host name:    com.focusblocker.native
echo   Manifest:     %MANIFEST_PATH%
echo   Executable:   %EXE_PATH%
echo   Extension ID: %EXT_ID%
echo   Startup:      focus-blocker-native.exe restore (on login)
echo.
echo Reload your extension at chrome://extensions and you're good to go.

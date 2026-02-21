@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Focus Blocker — Native Messaging Setup
echo   (Chrome + Edge)
echo ============================================
echo.

:: Use stable extension ID from manifest.json key field
set "EXT_ID=hoflokmdmfnhoncdnacgljbhppajkofb"
echo Using stable extension ID: %EXT_ID%
echo.

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

:: ---- Chrome registration ----
echo.
echo Registering native messaging host for Chrome...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.focusblocker.native" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% neq 0 (
    echo WARNING: Failed to register Chrome native messaging host.
)

:: ---- Edge registration ----
echo Registering native messaging host for Edge...
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.focusblocker.native" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% neq 0 (
    echo WARNING: Failed to register Edge native messaging host.
)

:: ---- Force-install policies (requires admin) ----
echo.
echo Registering force-install policies (requires admin privileges)...

reg add "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v "1" /t REG_SZ /d "%EXT_ID%" /f 2>nul
if %errorlevel% neq 0 (
    echo WARNING: Chrome force-install policy failed. Run as Administrator for this feature.
)

reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v "1" /t REG_SZ /d "%EXT_ID%" /f 2>nul
if %errorlevel% neq 0 (
    echo WARNING: Edge force-install policy failed. Run as Administrator for this feature.
)

:: ---- Auto-launch on Windows startup (restore mode) ----
echo.
echo Registering startup entry for restore mode...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FocusBlockerNative" /t REG_SZ /d "\"%EXE_PATH%\" restore" /f

if %errorlevel% neq 0 (
    echo WARNING: Failed to register startup entry. Auto-restore on reboot will not work.
)

echo.
echo ============================================
echo   Setup Complete!
echo ============================================
echo.
echo   Host name:    com.focusblocker.native
echo   Manifest:     %MANIFEST_PATH%
echo   Executable:   %EXE_PATH%
echo   Extension ID: %EXT_ID%
echo   Browsers:     Chrome + Edge
echo   Startup:      focus-blocker-native.exe restore (on login)
echo.
echo Load the extension in Chrome and/or Edge, then reload it.

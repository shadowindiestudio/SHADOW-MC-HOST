@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

:: ============================================================================
:: SHADOW MC HOST - INTERACTIVE SETUP MENU
:: ============================================================================
:: A menu-driven setup program for Windows users
:: Provides easy installation, configuration, and maintenance
:: ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SERVER_DIR=%ROOT%\server"
set "MANAGER_DIR=%ROOT%\manager"
set "BOT_DIR=%ROOT%\mc-bot"
set "DATA_ROOT=C:\ShadowMCHost"
set "INSTALL_DIR=%DATA_ROOT%\app"
set "SERVER_INSTALL_DIR=%DATA_ROOT%\data\servers\Server-1"

:: Get correct Desktop path (handles OneDrive redirection)
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP_PATH=%%D"

:: Color codes for output
for /f "tokens=1,2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do (
    set "DEL=%%b"
    set "ESC=%%b"
)

:: Initialize state
set "MENU_CHOICE="
set "SETUP_COMPLETE=0"
set "JAVA_DETECTED=0"
set "JAVA_VERSION=Not detected"
set "JAVA_EXE=java"
set "NODE_DETECTED=0"
set "NODE_VERSION=Not detected"
set "PAPER_DETECTED=0"
set "VIAVERSION_DETECTED=0"
set "ZEROTIER_DETECTED=0"
set "MANAGER_READY=0"

:: ============================================================================
:: MAIN MENU LOOP
:: ============================================================================
:MAIN_MENU
cls
call :PrintHeader
call :DetectComponents

echo.
echo  ================================================
echo  MAIN MENU - SHADOW MC HOST SETUP
echo  ================================================
echo.
echo  DETECTION STATUS:
echo  ------------------------------------------------
call :PrintDetectionStatus
echo  ------------------------------------------------
echo.
echo  PLEASE SELECT AN OPTION:
echo.
echo   [1]  Full Setup / Install Everything
echo   [2]  Check System Requirements
echo   [3]  Install / Update Java
echo   [4]  Install / Configure Minecraft Server
echo   [5]  Install Server Compatibility Plugins
echo   [6]  Configure RCON
echo   [7]  Configure Networking
echo   [8]  Install / Configure Discord Bot
echo   [9]  Configure Server
echo   [10] Create Desktop Shortcut
echo   [11] Repair Installation
echo   [12] Check Installation Status
echo   [13] Update Shadow MC Host Components
echo   [14] Launch Shadow MC Host
echo   [15] Uninstall / Remove Shadow MC Host
echo   [16] Exit
echo.
echo  ================================================
echo.

set /p "MENU_CHOICE=Enter your choice (1-16): "

if "%MENU_CHOICE%"=="1" goto FULL_SETUP
if "%MENU_CHOICE%"=="2" goto CHECK_REQUIREMENTS
if "%MENU_CHOICE%"=="3" goto INSTALL_JAVA
if "%MENU_CHOICE%"=="4" goto INSTALL_SERVER
if "%MENU_CHOICE%"=="5" goto INSTALL_PLUGINS
if "%MENU_CHOICE%"=="6" goto CONFIGURE_RCON
if "%MENU_CHOICE%"=="7" goto CONFIGURE_NETWORKING
if "%MENU_CHOICE%"=="8" goto INSTALL_BOT
if "%MENU_CHOICE%"=="9" goto CONFIGURE_SERVER
if "%MENU_CHOICE%"=="10" goto CREATE_SHORTCUT
if "%MENU_CHOICE%"=="11" goto REPAIR_INSTALLATION
if "%MENU_CHOICE%"=="12" goto CHECK_STATUS
if "%MENU_CHOICE%"=="13" goto UPDATE_COMPONENTS
if "%MENU_CHOICE%"=="14" goto LAUNCH_APPLICATION
if "%MENU_CHOICE%"=="15" goto UNINSTALL
if "%MENU_CHOICE%"=="16" goto EXIT_SETUP

call :ColorText 0C "Invalid choice. Please try again."
pause
goto MAIN_MENU

:: ============================================================================
:: MENU OPTIONS
:: ============================================================================

:FULL_SETUP
cls
call :PrintHeader
call :ColorText 0A "Starting Full Setup..."
echo.

call :StepCheckJava
call :StepInstallNodeJS
call :StepInstallPaperServer
call :StepInstallPlugins
call :StepConfigureRCON
call :StepConfigureNetworking
call :StepInstallBot
call :StepConfigureServer
call :StepCreateShortcut

call :ColorText 0A "Full Setup Complete!"
echo.
pause
goto MAIN_MENU

:CHECK_REQUIREMENTS
cls
call :PrintHeader
call :ColorText 03 "CHECKING SYSTEM REQUIREMENTS"
echo.

call :DetectJava
call :DetectNodeJS
call :DetectPaperServer
call :DetectViaVersion
call :DetectZeroTier

echo.
call :ColorText 07 "Requirements check complete."
pause
goto MAIN_MENU

:INSTALL_JAVA
cls
call :PrintHeader
call :ColorText 03 "INSTALLING/UPDATING JAVA"
echo.
call :InstallJava
if errorlevel 1 (
    call :ColorText 0C "Java installation failed."
) else (
    call :ColorText 0A "Java installation complete."
)
pause
goto MAIN_MENU

:INSTALL_SERVER
cls
call :PrintHeader
call :ColorText 03 "INSTALLING/CONFIGURING MINECRAFT SERVER"
echo.
call :InstallPaperServer
if errorlevel 1 (
    call :ColorText 0C "Minecraft server installation failed."
) else (
    call :ColorText 0A "Minecraft server installation complete."
)
pause
goto MAIN_MENU

:INSTALL_PLUGINS
cls
call :PrintHeader
call :ColorText 03 "INSTALLING SERVER COMPATIBILITY PLUGINS"
echo.
call :InstallViaVersion
call :InstallViaBackwards
call :InstallViaRewind
call :ColorText 0A "Plugin installation complete."
pause
goto MAIN_MENU

:CONFIGURE_RCON
cls
call :PrintHeader
call :ColorText 03 "CONFIGURING RCON"
echo.
call :ConfigureRCON
if errorlevel 1 (
    call :ColorText 0C "RCON configuration failed."
) else (
    call :ColorText 0A "RCON configuration complete."
)
pause
goto MAIN_MENU

:CONFIGURE_NETWORKING
cls
call :PrintHeader
call :ColorText 03 "CONFIGURING NETWORKING"
echo.
call :ConfigureNetworking
if errorlevel 1 (
    call :ColorText 0C "Networking configuration failed."
) else (
    call :ColorText 0A "Networking configuration complete."
)
pause
goto MAIN_MENU

:INSTALL_BOT
cls
call :PrintHeader
call :ColorText 03 "INSTALLING/CONFIGURING DISCORD BOT"
echo.
call :InstallBot
if errorlevel 1 (
    call :ColorText 0C "Discord bot installation failed."
) else (
    call :ColorText 0A "Discord bot installation complete."
)
pause
goto MAIN_MENU

:CONFIGURE_SERVER
cls
call :PrintHeader
call :ColorText 03 "CONFIGURING SERVER"
echo.
call :ConfigureServer
if errorlevel 1 (
    call :ColorText 0C "Server configuration failed."
) else (
    call :ColorText 0A "Server configuration complete."
)
pause
goto MAIN_MENU

:CREATE_SHORTCUT
cls
call :PrintHeader
call :ColorText 03 "CREATING DESKTOP SHORTCUT"
echo.
call :CreateDesktopShortcut
if errorlevel 1 (
    call :ColorText 0C "Failed to create desktop shortcut."
) else (
    call :ColorText 0A "Desktop shortcut created successfully!"
)
pause
goto MAIN_MENU

:REPAIR_INSTALLATION
cls
call :PrintHeader
call :ColorText 03 "REPAIRING INSTALLATION"
echo.
call :RepairInstallation
call :ColorText 0A "Repair complete."
pause
goto MAIN_MENU

:CHECK_STATUS
cls
call :PrintHeader
call :ColorText 03 "CHECKING INSTALLATION STATUS"
echo.
call :CheckInstallationStatus
call :ColorText 07 "Status check complete."
pause
goto MAIN_MENU

:UPDATE_COMPONENTS
cls
call :PrintHeader
call :ColorText 03 "UPDATING COMPONENTS"
echo.
call :UpdateComponents
call :ColorText 0A "Update complete."
pause
goto MAIN_MENU

:LAUNCH_APPLICATION
cls
call :PrintHeader
call :ColorText 03 "LAUNCHING SHADOW MC HOST"
echo.
call :LaunchApplication
if errorlevel 1 (
    call :ColorText 0C "Failed to launch application."
    pause
)
goto MAIN_MENU

:UNINSTALL
cls
call :PrintHeader
call :ColorText 0C "UNINSTALL SHADOW MC HOST"
echo.
call :ColorText 0E "WARNING: This will remove the application but preserve server data."
set /p "CONFIRM=Are you sure? (y/n): "
if /i "%CONFIRM%"=="y" (
    call :PerformUninstall
    call :ColorText 0A "Uninstall complete."
) else (
    call :ColorText 07 "Uninstall cancelled."
)
pause
goto MAIN_MENU

:EXIT_SETUP
cls
call :PrintHeader
call :ColorText 0A "Thank you for using SHADOW MC HOST Setup."
echo.
exit /b 0

:: ============================================================================
:: DETECTION FUNCTIONS
:: ============================================================================

:DetectComponents
:: Detect all major components
call :DetectJava
call :DetectNodeJS
call :DetectPaperServer
call :DetectViaVersion
call :DetectZeroTier
call :DetectManager

goto :eof

:DetectJava
set "JAVA_DETECTED=0"
set "JAVA_VERSION=Not detected"
set "JAVA_EXE=java"

:: First try java on PATH
where java >nul 2>&1
if not errorlevel 1 (
    set "JAVA_EXE=java"
    goto :CheckJavaVersion
)

:: Fallback: search common installation directories
for %%D in (
    "C:\Program Files\Zulu\zulu-25\bin\java.exe"
    "C:\Program Files\Zulu\zulu-21\bin\java.exe"
    "C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot\bin\java.exe"
    "C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe"
    "C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot\bin\java.exe"
    "C:\Program Files\Java\jdk-21\bin\java.exe"
    "C:\Program Files\Java\jdk-25\bin\java.exe"
    "C:\Program Files\Amazon Corretto\jdk21.0.7_6\bin\java.exe"
) do (
    if exist %%D (
        set "JAVA_EXE=%%~D"
        goto :CheckJavaVersion
    )
)

:: Also try JAVA_HOME if set
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
        goto :CheckJavaVersion
    )
)

goto :eof

:CheckJavaVersion
:: Run java -version and capture output to temp file
set "JAVA_VER_TMP=%TEMP%\smh_jver_%RANDOM%.txt"
"%JAVA_EXE%" -version >"%JAVA_VER_TMP%" 2>&1

:: Extract version number — version line is: openjdk version "25.0.4.1" ...
for /f "tokens=3 delims= " %%V in ('findstr "version" "%JAVA_VER_TMP%"') do (
    set "java_ver=%%V"
    set "java_ver=!java_ver:"=!"
    :: Extract major version (before first dot)
    for /f "tokens=1 delims=." %%M in ("!java_ver!") do set "java_major=%%M"
    if !java_major! geq 21 (
        set "JAVA_DETECTED=1"
        set "JAVA_VERSION=!java_ver!"
    )
)
del "%JAVA_VER_TMP%" >nul 2>&1
goto :eof

:DetectNodeJS
set "NODE_DETECTED=0"
set "NODE_VERSION=Not detected"
where node >nul 2>&1
if errorlevel 1 (
    set "NODE_DETECTED=0"
    goto :eof
)
set "NODE_DETECTED=1"
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
goto :eof

:DetectPaperServer
set "PAPER_DETECTED=0"
if exist "%SERVER_DIR%\server.jar" (
    set "PAPER_DETECTED=1"
    goto :eof
)
if exist "%SERVER_DIR%\paper-*.jar" (
    set "PAPER_DETECTED=1"
    goto :eof
)
if exist "%SERVER_INSTALL_DIR%\server.jar" (
    set "PAPER_DETECTED=1"
    goto :eof
)
if exist "%SERVER_INSTALL_DIR%\paper-*.jar" (
    set "PAPER_DETECTED=1"
    goto :eof
)
goto :eof

:DetectViaVersion
set VIAVERSION_DETECTED=0
if exist "%SERVER_DIR%\plugins\ViaVersion.jar" (
    set VIAVERSION_DETECTED=1
    goto :eof
)
if exist "%SERVER_INSTALL_DIR%\plugins\ViaVersion.jar" (
    set VIAVERSION_DETECTED=1
    goto :eof
)
goto :eof

:DetectZeroTier
set "ZEROTIER_DETECTED=0"
:: Check if service is running (correct service name is ZeroTierOneService)
sc query ZeroTierOneService >nul 2>&1
if not errorlevel 1 (
    set "ZEROTIER_DETECTED=1"
    goto :eof
)
:: Also try the old service name
sc query ZeroTierOne >nul 2>&1
if not errorlevel 1 (
    set "ZEROTIER_DETECTED=1"
    goto :eof
)
:: Check known install paths
if exist "C:\Program Files (x86)\ZeroTier\One\zerotier-one_x64.exe" (
    set "ZEROTIER_DETECTED=1"
    goto :eof
)
if exist "C:\Program Files\ZeroTier\One\zerotier-one_x64.exe" (
    set "ZEROTIER_DETECTED=1"
    goto :eof
)
where zerotier-one >nul 2>&1
if not errorlevel 1 set "ZEROTIER_DETECTED=1"
goto :eof

:DetectManager
set MANAGER_READY=0
if exist "%MANAGER_DIR%\node_modules\electron" (
    set MANAGER_READY=1
)
goto :eof

:PrintDetectionStatus
:: Print detection status with checkmarks
if %JAVA_DETECTED%==1 (
    call :ColorText 0A "[OK] Java %JAVA_VERSION% detected"
) else (
    call :ColorText 0C "[--] Java 21+ not found"
)

if %NODE_DETECTED%==1 (
    call :ColorText 0A "[OK] Node.js %NODE_VERSION% detected"
) else (
    call :ColorText 0C "[--] Node.js not found"
)

if %PAPER_DETECTED%==1 (
    call :ColorText 0A "[OK] Paper server detected"
) else (
    call :ColorText 0C "[--] Paper server not found"
)

if %VIAVERSION_DETECTED%==1 (
    call :ColorText 0A "[OK] ViaVersion detected"
) else (
    call :ColorText 07 "[ ] ViaVersion not installed"
)

if %ZEROTIER_DETECTED%==1 (
    call :ColorText 0A "[OK] ZeroTier detected"
) else (
    call :ColorText 07 "[ ] ZeroTier not installed"
)

if %MANAGER_READY%==1 (
    call :ColorText 0A "[OK] Manager dependencies installed"
) else (
    call :ColorText 0C "[--] Manager not ready"
)

goto :eof

:: ============================================================================
:: INSTALLATION FUNCTIONS
:: ============================================================================

:StepCheckJava
call :ColorText 03 "[1/7] Checking Java..."
call :DetectJava
if %JAVA_DETECTED%==0 (
    call :InstallJava
    if errorlevel 1 (
        call :ColorText 0C "DONE (FAILED)"
        exit /b 1
    )
)
call :ColorText 0A "DONE"
goto :eof

:StepInstallNodeJS
call :ColorText 03 "[2/7] Checking Node.js..."
call :DetectNodeJS
if %NODE_DETECTED%==0 (
    call :InstallNodeJS
    if errorlevel 1 (
        call :ColorText 0C "DONE (FAILED)"
        exit /b 1
    )
)
call :ColorText 0A "DONE"
goto :eof

:StepInstallPaperServer
call :ColorText 03 "[3/7] Downloading Paper..."
call :InstallPaperServer
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepInstallPlugins
call :ColorText 03 "[4/7] Installing ViaVersion..."
call :InstallViaVersion
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
call :ColorText 03 "[5/7] Installing ViaBackwards..."
call :InstallViaBackwards
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
call :ColorText 03 "[6/7] Installing ViaRewind..."
call :InstallViaRewind
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepConfigureRCON
call :ColorText 03 "[7/7] Configuring RCON..."
call :ConfigureRCON
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepConfigureNetworking
call :ColorText 03 "Configuring networking..."
call :ConfigureNetworking
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepInstallBot
call :ColorText 03 "Installing Discord bot..."
call :InstallBot
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepConfigureServer
call :ColorText 03 "Configuring server..."
call :ConfigureServer
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:StepCreateShortcut
call :ColorText 03 "Creating shortcut..."
call :CreateDesktopShortcut
if errorlevel 1 (
    call :ColorText 0C "SKIPPED"
) else (
    call :ColorText 0A "DONE"
)
goto :eof

:: ============================================================================
:: INSTALL JAVA
:: ============================================================================

:InstallJava
call :ColorText 07 "Installing Java 21 (Azul Zulu)..."
winget install --id Azul.Zulu.21.JDK --accept-source-agreements --accept-package-agreements -e >nul 2>&1
if errorlevel 1 (
    call :ColorText 0E "Winget failed. Trying alternative method..."
    :: Try with Java 25 as fallback
    winget install --id Azul.Zulu.25.JDK --accept-source-agreements --accept-package-agreements -e >nul 2>&1
    if errorlevel 1 (
        call :ColorText 0C "ERROR: Failed to install Java."
        echo Please install Java 21+ manually from https://www.azul.com/downloads/
        exit /b 1
    )
)

:: Verify installation
call :DetectJava
if %JAVA_DETECTED%==0 (
    call :ColorText 0C "ERROR: Java installation verification failed."
    exit /b 1
)

call :ColorText 0A "Java %JAVA_VERSION% installed successfully!"
goto :eof

:: ============================================================================
:: INSTALL NODE.JS
:: ============================================================================

:InstallNodeJS
call :ColorText 07 "Installing Node.js LTS..."
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e >nul 2>&1
if errorlevel 1 (
    call :ColorText 0C "ERROR: Failed to install Node.js"
    echo Please install Node.js LTS from https://nodejs.org/
    exit /b 1
)

:: Verify installation
call :DetectNodeJS
if %NODE_DETECTED%==0 (
    call :ColorText 0C "ERROR: Node.js installation verification failed."
    exit /b 1
)

call :ColorText 0A "Node.js %NODE_VERSION% installed successfully!"
goto :eof

:: ============================================================================
:: INSTALL PAPER SERVER
:: ============================================================================

:InstallPaperServer
:: Check if user wants to select version
set /p "SELECT_VERSION=Do you want to select a specific Minecraft version? (y/n): "
if /i "%SELECT_VERSION%"=="y" (
    goto SELECT_PAPER_VERSION
)

:: Default to latest stable Paper version
set "PAPERMC_VERSION=1.21.4"
set "PAPERMC_BUILD=191"
set "PAPERMC_JAR=paper-1.21.4-191.jar"
set "PAPERMC_URL=https://papermc.io/api/v2/projects/paper/versions/1.21.4/builds/191/downloads/paper-1.21.4-191.jar"

goto DOWNLOAD_PAPER


:SELECT_PAPER_VERSION
echo.
call :ColorText 07 "Available Paper versions:"
echo  1. 1.21.4 (Latest Stable)
echo  2. 1.21.3
echo  3. 1.21.2
echo  4. 1.21.1
echo  5. 1.21
echo  6. 1.20.6
echo  7. Custom version
echo.
set /p "VERSION_CHOICE=Select version (1-7): "

if "%VERSION_CHOICE%"=="1" set "PAPERMC_VERSION=1.21.4"
if "%VERSION_CHOICE%"=="2" set "PAPERMC_VERSION=1.21.3"
if "%VERSION_CHOICE%"=="3" set "PAPERMC_VERSION=1.21.2"
if "%VERSION_CHOICE%"=="4" set "PAPERMC_VERSION=1.21.1"
if "%VERSION_CHOICE%"=="5" set "PAPERMC_VERSION=1.21"
if "%VERSION_CHOICE%"=="6" set "PAPERMC_VERSION=1.20.6"
if "%VERSION_CHOICE%"=="7" (
    set /p "PAPERMC_VERSION=Enter Minecraft version (e.g., 1.20.4): "
)
if not defined PAPERMC_VERSION set "PAPERMC_VERSION=1.21.4"

:DOWNLOAD_PAPER
if not exist "%SERVER_DIR%" (
    mkdir "%SERVER_DIR%"
    call :ColorText 0A "Created server directory"
)

if exist "%SERVER_DIR%\server.jar" (
    call :ColorText 07 "server.jar already exists - using existing file"
    set "PAPER_DETECTED=1"
    goto :eof
)
if exist "%SERVER_DIR%\paper-*.jar" (
    call :ColorText 07 "Paper server JAR already exists - using existing file"
    set "PAPER_DETECTED=1"
    goto :eof
)

:: Use PaperMC v3 API to resolve and download latest build dynamically to a temporary file
call :ColorText 07 "Resolving latest PaperMC %PAPERMC_VERSION% build..."
set "PAPER_API_URL=https://fill.papermc.io/v3/projects/paper/versions/%PAPERMC_VERSION%/builds"
set "PAPER_TEMP=%SERVER_DIR%\server.jar.tmp"
set "PAPER_DEST=%SERVER_DIR%\server.jar"

powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $wc = New-Object Net.WebClient; $wc.Headers.Add('User-Agent','ShadowMCHost/1.0'); $json = $wc.DownloadString($env:PAPER_API_URL); $builds = ConvertFrom-Json $json; $arr = @($builds); if ($arr.Count -eq 0) { Write-Host 'No builds found'; exit 1 }; $latest = ($arr | Sort-Object id -Descending)[0]; $url = $latest.downloads.'server:default'.url; if (-not $url) { foreach ($p in $latest.downloads.PSObject.Properties) { if ($p.Value.url) { $url = $p.Value.url; break } } }; if (-not $url) { Write-Host 'No download URL in build'; exit 1 }; Write-Host ('Downloading build ' + $latest.id + ' from ' + $url); $wc.DownloadFile($url, $env:PAPER_TEMP); $f = Get-Item $env:PAPER_TEMP; if ($f.Length -lt 5000000) { Write-Host ('Downloaded file size (' + $f.Length + ' bytes) too small for valid server JAR'); if (Test-Path $env:PAPER_TEMP) { Remove-Item $env:PAPER_TEMP -ErrorAction SilentlyContinue }; exit 1 }; $bytes = [System.IO.File]::ReadAllBytes($env:PAPER_TEMP); if ($bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) { Write-Host 'Downloaded file is not a valid ZIP/JAR archive'; if (Test-Path $env:PAPER_TEMP) { Remove-Item $env:PAPER_TEMP -ErrorAction SilentlyContinue }; exit 1 }; Move-Item -Force $env:PAPER_TEMP $env:PAPER_DEST; exit 0 } catch { Write-Host ('Error: ' + $_.Exception.Message); if (Test-Path $env:PAPER_TEMP) { Remove-Item $env:PAPER_TEMP -ErrorAction SilentlyContinue }; exit 1 } }"

if exist "%SERVER_DIR%\server.jar" (
    call :ColorText 0A "[OK] PaperMC %PAPERMC_VERSION% downloaded and verified!"
    set "PAPER_DETECTED=1"
) else (
    call :ColorText 0C "ERROR: Failed to download or validate PaperMC %PAPERMC_VERSION%"
    call :ColorText 07 "Please manually download server.jar from https://papermc.io/downloads"
    exit /b 1
)

if not exist "%SERVER_DIR%\eula.txt" (
    echo eula=true> "%SERVER_DIR%\eula.txt"
    call :ColorText 0A "Created eula.txt"
)

if not exist "%SERVER_DIR%\server.properties" (
    if exist "%ROOT%\server.properties" (
        copy "%ROOT%\server.properties" "%SERVER_DIR%\server.properties" >nul
        call :ColorText 0A "Copied server.properties from template"
    ) else (
        call :CreateDefaultServerProperties
        call :ColorText 0A "Created default server.properties"
    )
)

goto :eof

:: ============================================================================
:: INSTALL PLUGINS
:: ============================================================================

:InstallViaVersion
if not exist "%SERVER_DIR%\plugins" mkdir "%SERVER_DIR%\plugins"

if exist "%SERVER_DIR%\plugins\ViaVersion.jar" (
    call :ColorText 07 "ViaVersion already installed"
    set "VIAVERSION_DETECTED=1"
    goto :eof
)

call :ColorText 07 "Downloading ViaVersion..."
set "PLUGIN_GH_URL=https://github.com/ViaVersion/ViaVersion/releases/latest/download/ViaVersion.jar"
set "PLUGIN_SLUG=viaversion"
set "PLUGIN_DEST=%SERVER_DIR%\plugins\ViaVersion.jar"
call :DownloadPlugin

if exist "%SERVER_DIR%\plugins\ViaVersion.jar" (
    set "VIAVERSION_DETECTED=1"
    call :ColorText 0A "[OK] ViaVersion installed!"
) else (
    call :ColorText 0E "[FAIL] Failed to download ViaVersion"
    exit /b 1
)
goto :eof

:InstallViaBackwards
if not exist "%SERVER_DIR%\plugins" mkdir "%SERVER_DIR%\plugins"

if exist "%SERVER_DIR%\plugins\ViaBackwards.jar" (
    call :ColorText 07 "ViaBackwards already installed"
    goto :eof
)

call :ColorText 07 "Downloading ViaBackwards..."
set "PLUGIN_GH_URL=https://github.com/ViaVersion/ViaBackwards/releases/latest/download/ViaBackwards.jar"
set "PLUGIN_SLUG=viabackwards"
set "PLUGIN_DEST=%SERVER_DIR%\plugins\ViaBackwards.jar"
call :DownloadPlugin

if exist "%SERVER_DIR%\plugins\ViaBackwards.jar" (
    call :ColorText 0A "[OK] ViaBackwards installed!"
) else (
    call :ColorText 0E "[FAIL] Failed to download ViaBackwards"
    exit /b 1
)
goto :eof

:InstallViaRewind
if not exist "%SERVER_DIR%\plugins" mkdir "%SERVER_DIR%\plugins"

if exist "%SERVER_DIR%\plugins\ViaRewind.jar" (
    call :ColorText 07 "ViaRewind already installed"
    goto :eof
)

call :ColorText 07 "Downloading ViaRewind..."
set "PLUGIN_GH_URL=https://github.com/ViaVersion/ViaRewind/releases/latest/download/ViaRewind.jar"
set "PLUGIN_SLUG=viarewind"
set "PLUGIN_DEST=%SERVER_DIR%\plugins\ViaRewind.jar"
call :DownloadPlugin

if exist "%SERVER_DIR%\plugins\ViaRewind.jar" (
    call :ColorText 0A "[OK] ViaRewind installed!"
) else (
    call :ColorText 0E "[FAIL] Failed to download ViaRewind"
    exit /b 1
)
goto :eof

:: DownloadPlugin: uses PLUGIN_GH_URL, PLUGIN_SLUG, PLUGIN_DEST
:: Tries GitHub first, falls back to Modrinth API
:DownloadPlugin
powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object Net.WebClient; $wc.Headers.Add('User-Agent','Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShadowMCHost/1.0'); try { $wc.DownloadFile($env:PLUGIN_GH_URL, $env:PLUGIN_DEST); if ((Get-Item $env:PLUGIN_DEST -ErrorAction SilentlyContinue).Length -gt 1000) { exit 0 } } catch {}; try { $json = $wc.DownloadString('https://api.modrinth.com/v2/project/' + $env:PLUGIN_SLUG + '/version'); $v = ConvertFrom-Json $json; $dl = $v[0].files[0].url; if ($dl) { $wc.DownloadFile($dl, $env:PLUGIN_DEST); if ((Get-Item $env:PLUGIN_DEST -ErrorAction SilentlyContinue).Length -gt 1000) { exit 0 } } } catch {}; exit 1 }"
goto :eof

:: ============================================================================
:: CONFIGURE RCON
:: ============================================================================

:ConfigureRCON
:: Check if server.properties exists
if not exist "%SERVER_DIR%\server.properties" (
    call :CreateDefaultServerProperties
)

:: Enable RCON and set password
set /p "RCON_PASSWORD=Enter RCON password (leave blank for random): "
if "%RCON_PASSWORD%"=="" (
    :: Generate random password
    set "RCON_PASSWORD=%RANDOM%%RANDOM%%RANDOM%"
    call :ColorText 07 "Generated random RCON password: %RCON_PASSWORD%"
)

:: Update server.properties
call :UpdateServerProperty "enable-rcon" "true"
call :UpdateServerProperty "rcon.port" "25575"
call :UpdateServerProperty "rcon.password" "%RCON_PASSWORD%"

call :ColorText 0A "RCON configured with password: %RCON_PASSWORD%"
call :ColorText 07 "Port: 25575"

goto :eof

:: ============================================================================
:: CONFIGURE NETWORKING
:: ============================================================================

:ConfigureNetworking
set /p "CONFIG_NETWORK=Configure networking options? (y/n): "
if /i "%CONFIG_NETWORK%"=="n" (
    call :ColorText 07 "Networking configuration skipped"
    goto :eof
)

:: Check for ZeroTier
call :DetectZeroTier
if %ZEROTIER_DETECTED%==0 (
    set /p "INSTALL_ZEROTIER=Install ZeroTier for networking? (y/n): "
    if /i "%INSTALL_ZEROTIER%"=="y" (
        call :InstallZeroTier
    )
)

:: Configure server.properties networking
call :UpdateServerProperty "server-port" "25565"
call :UpdateServerProperty "online-mode" "false"

call :ColorText 0A "Networking configured"

goto :eof

:InstallZeroTier
call :ColorText 07 "Installing ZeroTier..."
winget install --id ZeroTier.ZeroTier --accept-source-agreements --accept-package-agreements -e >nul 2>&1
if errorlevel 1 (
    call :ColorText 0E "Failed to install ZeroTier via winget"
    call :ColorText 07 "Please download from https://www.zerotier.com/download/"
    exit /b 1
)

call :ColorText 0A "ZeroTier installed!"
call :ColorText 07 "Please join your network manually from the ZeroTier application."
set ZEROTIER_DETECTED=1
goto :eof

:: ============================================================================
:: INSTALL DISCORD BOT
:: ============================================================================

:InstallBot
:: Check if bot directory exists
if not exist "%BOT_DIR%" (
    call :ColorText 0C "ERROR: mc-bot directory not found"
    exit /b 1
)

:: Install npm dependencies
if exist "%BOT_DIR%\package.json" (
    if not exist "%BOT_DIR%\node_modules" (
        call :ColorText 07 "Installing bot dependencies..."
        cd /d "%BOT_DIR%"
        call npm install
        if errorlevel 1 (
            call :ColorText 0E "Failed to install bot dependencies"
            exit /b 1
        )
        call :ColorText 0A "Bot dependencies installed!"
    ) else (
        call :ColorText 07 "Bot dependencies already installed"
    )
)

:: Create .env file if missing
if not exist "%BOT_DIR%\.env" (
    call :CreateBotEnv
    call :ColorText 0A ".env file created"
) else (
    call :ColorText 07 ".env file already exists"
)

goto :eof

:: ============================================================================
:: CONFIGURE SERVER
:: ============================================================================

:ConfigureServer
:: Update server.properties with user preferences
set /p "SERVER_NAME=Enter server name (MOTD): "
if "%SERVER_NAME%"=="" set "SERVER_NAME=A Shadow MC Host Server"

set /p "MAX_PLAYERS=Enter max players (default 20): "
if "%MAX_PLAYERS%"=="" set "MAX_PLAYERS=20"

set /p "GAMEMODE=Enter gamemode (survival/creative/adventure): "
if "%GAMEMODE%"=="" set "GAMEMODE=survival"

set /p "DIFFICULTY=Enter difficulty (peaceful/easy/normal/hard): "
if "%DIFFICULTY%"=="" set "DIFFICULTY=normal"

:: Update properties
call :UpdateServerProperty "motd" "%SERVER_NAME%"
call :UpdateServerProperty "max-players" "%MAX_PLAYERS%"
call :UpdateServerProperty "gamemode" "%GAMEMODE%"
call :UpdateServerProperty "difficulty" "%DIFFICULTY%"

call :ColorText 0A "Server configured!"

goto :eof

:: ============================================================================
:: CREATE DESKTOP SHORTCUT
:: ============================================================================

:CreateDesktopShortcut
if not exist "%MANAGER_DIR%\node_modules\.bin\electron.cmd" (
    call :ColorText 0E "Electron launcher not found. Please run full setup first."
    exit /b 1
)

:: Ensure launch-shadow.bat launcher exists
if not exist "%ROOT%\launch-shadow.bat" (
    (
        echo @echo off
        echo cd /d "%MANAGER_DIR%"
        echo start "" "node_modules\.bin\electron.cmd" .
    ) > "%ROOT%\launch-shadow.bat"
)

call :ColorText 07 "Creating desktop shortcut..."

:: Set env vars so PowerShell can access them without quote/space issues
set "LNK_PATH=%DESKTOP_PATH%\Shadow MC Host.lnk"
set "LNK_TARGET=%ROOT%\launch-shadow.bat"
set "LNK_WORKDIR=%ROOT%"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($env:LNK_PATH); $s.TargetPath = $env:LNK_TARGET; $s.WorkingDirectory = $env:LNK_WORKDIR; $s.Description = 'Launch Shadow MC Host Manager'; $s.Save()" >nul 2>&1

if exist "%DESKTOP_PATH%\Shadow MC Host.lnk" (
    call :ColorText 0A "[OK] Desktop shortcut created: Shadow MC Host.lnk"
) else (
    :: Fallback: plain .bat launcher on desktop
    (
        echo @echo off
        echo cd /d "%ROOT%"
        echo cd manager
        echo start "" "node_modules\.bin\electron.cmd" .
    ) > "%DESKTOP_PATH%\Shadow MC Host.bat"
    call :ColorText 0E "Could not create .lnk - created Shadow MC Host.bat on Desktop instead"
)

goto :eof

:: ============================================================================
:: REPAIR INSTALLATION
:: ============================================================================

:RepairInstallation
call :ColorText 07 "Checking and repairing installation..."
echo.

:: Check Java
call :DetectJava
if %JAVA_DETECTED%==0 (
    call :ColorText 0E "Java missing - repairing..."
    call :InstallJava
)

:: Check Node.js
call :DetectNodeJS
if %NODE_DETECTED%==0 (
    call :ColorText 0E "Node.js missing - repairing..."
    call :InstallNodeJS
)

:: Check Paper server
call :DetectPaperServer
if %PAPER_DETECTED%==0 (
    call :ColorText 0E "Paper server missing - repairing..."
    call :InstallPaperServer
)

:: Check manager dependencies
call :DetectManager
if %MANAGER_READY%==0 (
    call :ColorText 0E "Manager dependencies missing - repairing..."
    cd /d "%MANAGER_DIR%"
    call npm install
)

:: Check bot dependencies
if exist "%BOT_DIR%\package.json" (
    if not exist "%BOT_DIR%\node_modules" (
        call :ColorText 0E "Bot dependencies missing - repairing..."
        cd /d "%BOT_DIR%"
        call npm install
    )
)

:: Recreate shortcut
call :CreateDesktopShortcut

call :ColorText 0A "Repair complete!"

goto :eof

:: ============================================================================
:: CHECK INSTALLATION STATUS
:: ============================================================================

:CheckInstallationStatus
call :ColorText 07 "Checking installation status..."
echo.

set "STATUS_COUNT=0"

call :DetectJava
if %JAVA_DETECTED%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] Java: INSTALLED (v%JAVA_VERSION%)"
) else (
    call :ColorText 0C "[✗] Java: NOT INSTALLED"
)

call :DetectNodeJS
if %NODE_DETECTED%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] Node.js: INSTALLED (v%NODE_VERSION%)"
) else (
    call :ColorText 0C "[✗] Node.js: NOT INSTALLED"
)

call :DetectPaperServer
if %PAPER_DETECTED%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] Paper Server: INSTALLED"
) else (
    call :ColorText 0C "[✗] Paper Server: NOT INSTALLED"
)

call :DetectViaVersion
if %VIAVERSION_DETECTED%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] ViaVersion: INSTALLED"
) else (
    call :ColorText 07 "[ ] ViaVersion: NOT INSTALLED"
)

call :DetectZeroTier
if %ZEROTIER_DETECTED%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] ZeroTier: INSTALLED"
) else (
    call :ColorText 07 "[ ] ZeroTier: NOT INSTALLED"
)

call :DetectManager
if %MANAGER_READY%==1 (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] Manager: READY"
) else (
    call :ColorText 0C "[✗] Manager: NOT READY"
)

if exist "%DESKTOP_PATH%\Shadow MC Host.lnk" (
    set /a STATUS_COUNT+=1
    call :ColorText 0A "[✓] Desktop Shortcut: EXISTS"
) else (
    call :ColorText 07 "[ ] Desktop Shortcut: MISSING"
)

echo.
call :ColorText 07 "Status: %STATUS_COUNT%/7 components ready"

goto :eof

:: ============================================================================
:: UPDATE COMPONENTS
:: ============================================================================

:UpdateComponents
call :ColorText 07 "Updating components..."
echo.

:: Update Node.js dependencies
if exist "%MANAGER_DIR%\package.json" (
    cd /d "%MANAGER_DIR%"
    call :ColorText 07 "Updating manager dependencies..."
    call npm update
)

if exist "%BOT_DIR%\package.json" (
    cd /d "%BOT_DIR%"
    call :ColorText 07 "Updating bot dependencies..."
    call npm update
)

:: Check for newer Paper version
set /p "UPDATE_PAPER=Check for newer Paper version? (y/n): "
if /i "%UPDATE_PAPER%"=="y" (
    call :ColorText 07 "Checking for Paper updates..."
    :: For now, just reinstall the same version
    call :InstallPaperServer
)

call :ColorText 0A "Update complete!"

goto :eof

:: ============================================================================
:: LAUNCH APPLICATION
:: ============================================================================

:LaunchApplication
call :ColorText 07 "Launching SHADOW MC HOST..."

:: Check if we should use the installed version or repo version
if exist "%INSTALL_DIR%\manager\node_modules\.bin\electron.cmd" (
    cd /d "%INSTALL_DIR%\manager"
    start "" "electron.cmd" .
) else if exist "%MANAGER_DIR%\node_modules\.bin\electron.cmd" (
    cd /d "%MANAGER_DIR%"
    start "" "node_modules\.bin\electron.cmd" .
) else (
    call :ColorText 0C "ERROR: Electron launcher not found"
    call :ColorText 07 "Please run full setup first"
    exit /b 1
)

call :ColorText 0A "Application launched!"

goto :eof

:: ============================================================================
:: UNINSTALL
:: ============================================================================

:PerformUninstall
call :ColorText 0E "Uninstalling SHADOW MC HOST..."

:: Remove desktop shortcut
if exist "%DESKTOP_PATH%\Shadow MC Host.lnk" (
    del "%DESKTOP_PATH%\Shadow MC Host.lnk"
    call :ColorText 0A "Removed desktop shortcut"
)
if exist "%DESKTOP_PATH%\Shadow MC Host.bat" (
    del "%DESKTOP_PATH%\Shadow MC Host.bat"
    call :ColorText 0A "Removed desktop launcher"
)

:: Remove launch script
if exist "%ROOT%\launch-shadow.bat" (
    del "%ROOT%\launch-shadow.bat"
    call :ColorText 0A "Removed launch script"
)

:: Runtime data is at DATA_ROOT (C:\ShadowMCHost)
:: App files are at INSTALL_DIR (C:\ShadowMCHost\app)
:: Server worlds and data are at C:\ShadowMCHost\data\servers — NEVER deleted
if exist "%INSTALL_DIR%" (
    call :ColorText 07 "Installed app files: %INSTALL_DIR%"
    call :ColorText 07 "To remove app files, manually delete: %INSTALL_DIR%"
)

call :ColorText 0A "NOTE: Server worlds and data are preserved at: %DATA_ROOT%\data\servers"
call :ColorText 07 "To completely remove all data, manually delete: %DATA_ROOT%"

goto :eof

:: ============================================================================
:: UTILITY FUNCTIONS
:: ============================================================================

:PrintHeader
call :ColorText 0A "================================================"
echo.
call :ColorText 0A "       SHADOW MC HOST - SETUP MENU            "
call :ColorText 0A "================================================"
echo.
goto :eof

:ColorText
setlocal DisableDelayedExpansion
set "color=%~1"
set "text=%~2"
if not defined text (
    if "%~2"=="" (
        if not "%~1"=="" (
            if /i not "%~1"=="0A" if /i not "%~1"=="0C" if /i not "%~1"=="0E" if /i not "%~1"=="03" if /i not "%~1"=="0B" if /i not "%~1"=="07" (
                set "text=%~1"
                set "color=07"
            )
        )
    )
)
if not defined text (
    endlocal
    goto :eof
)

set "ansi=0m"
if /i "%color%"=="0A" set "ansi=92m"
if /i "%color%"=="0C" set "ansi=91m"
if /i "%color%"=="0E" set "ansi=93m"
if /i "%color%"=="03" set "ansi=96m"
if /i "%color%"=="0B" set "ansi=96m"
if /i "%color%"=="07" set "ansi=0m"

if defined ESC (
    echo %ESC%[%ansi%%text%%ESC%[0m
) else (
    echo %text%
)
endlocal
goto :eof

:DownloadFile
set "url=%~1"
set "dest=%~2"
call :ColorText 07 "Downloading %~nx1..."
powershell -Command "(New-Object Net.WebClient).DownloadFile('%url%', '%dest%')" >nul 2>&1
if errorlevel 1 (
    call :ColorText 0E "Download failed: %url%"
    exit /b 1
)
goto :eof

:CreateDefaultServerProperties
(
    echo #Minecraft server properties
    echo server-port=25565
    echo enable-rcon=true
    echo rcon.port=25575
    echo rcon.password=change-this-password
    echo gamemode=survival
    echo difficulty=normal
    echo max-players=20
    echo view-distance=10
    echo simulation-distance=10
    echo motd=A Shadow MC Host Server
    echo online-mode=false
    echo enable-command-block-overrides=false
    echo enable-jmx-monitoring=false
    echo broadcast-rcon-to-ops=true
    echo broadcast-console-to-ops=true
    echo pvp=true
    echo allow-flight=false
    echo allow-nether=true
    echo spawn-monsters=true
    echo spawn-animals=true
    echo spawn-npcs=true
    echo level-name=world
    echo level-type=minecraft:normal
    echo hardcore=false
    echo enable-whitelist=false
) > "%SERVER_DIR%\server.properties"
goto :eof

:UpdateServerProperty
set "key=%~1"
set "value=%~2"
:: Use PowerShell to update the property
powershell -Command "$file = '%SERVER_DIR%\server.properties'; $content = Get-Content $file; $updated = $false; $newContent = @(); foreach ($line in $content) { if ($line -match '^$args[0]=') { $newContent += '$args[0]=$args[1]'; $updated = $true } else { $newContent += $line } }; if (-not $updated) { $newContent += '$args[0]=$args[1]' }; $newContent | Out-File $file -Encoding utf8" "%key%" "%value%" >nul 2>&1
goto :eof

:CreateBotEnv
(
    echo # Discord Bot Configuration
    echo # Get your token from: https://discord.com/developers/applications
    echo TOKEN=your-bot-token-here
    echo GUILD_ID=your-server-id-here
    echo CLIENT_ID=your-application-id-here
    echo SERVER_PATH=../
    echo SERVER_JAR=server.jar
    echo JAVA_PATH=C:\Program Files\Zulu\zulu-21\bin\java.exe
    echo RCON_HOST=127.0.0.1
    echo RCON_PORT=25575
    echo RCON_PASSWORD=change-this-local-password
) > "%BOT_DIR%\.env"
goto :eof

:: ============================================================================
:: END OF SCRIPT
:: ============================================================================

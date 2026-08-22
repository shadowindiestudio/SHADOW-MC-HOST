@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "MANAGER_DIR=%ROOT%manager"
set "BOT_DIR=%ROOT%mc-bot"
set "JAVA_INSTALL_PATH=C:\Program Files\Zulu\zulu-25"

cls
echo ================================
echo       SHADOW MC HOST SETUP
echo ================================
echo.
echo This script checks everything needed,
 echo installs missing tools automatically,
 echo and gets the server ready to start.
echo.

:: ---------------------------
:: 1) Install Node.js if missing
:: ---------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [1/6] Node.js not found. Installing Node.js LTS...
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e
    if errorlevel 1 (
        echo Failed to install Node.js.
        echo Please install Node.js LTS from https://nodejs.org/
        pause
        exit /b 1
    )
    echo Node.js installed.
) else (
    echo [1/6] Node.js found.
    node -v
)

:: ---------------------------
:: 2) Install Git if missing
:: ---------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo [2/6] Git not found. Installing Git...
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements -e
    if errorlevel 1 (
        echo Git install failed, but the project can still work without it.
    )
) else (
    echo [2/6] Git found.
    git --version
)

:: ---------------------------
:: 3) Install Java 25 if missing
:: ---------------------------
where java >nul 2>&1
if errorlevel 1 (
    set "JAVA_MISSING=1"
) else (
    java -version 2>&1 | findstr /R /C:"version \"[2-9][0-9]"" >nul
    if errorlevel 1 (
        set "JAVA_MISSING=1"
    ) else (
        set "JAVA_MISSING=0"
    )
)

if "%JAVA_MISSING%"=="1" (
    echo [3/6] Java 25+ is required for the Paper server. Installing Azul Zulu JDK 25...
    winget install --id Azul.Zulu.25.JDK --accept-source-agreements --accept-package-agreements -e
    if errorlevel 1 (
        echo Java 25 install failed.
        echo Please install Java 25+ from https://www.azul.com/downloads/
        pause
        exit /b 1
    )
    set "JAVA_HOME=%JAVA_INSTALL_PATH%"
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

echo [3/6] Java version:
java -version

:: ---------------------------
:: 4) Make sure server files exist
:: ---------------------------
if not exist "%SERVER_DIR%\server.jar" (
    echo [4/6] Server JAR is missing in the server folder.
    echo Please place your PaperMC server.jar in: %SERVER_DIR%
    echo Example: %SERVER_DIR%\server.jar
    pause
    exit /b 1
)

if not exist "%SERVER_DIR%\eula.txt" (
    echo eula=true> "%SERVER_DIR%\eula.txt"
)

if not exist "%SERVER_DIR%\server.properties" (
    echo [4/6] server.properties was not found. Copying a default one from the root folder.
    if exist "%ROOT%server.properties" copy "%ROOT%server.properties" "%SERVER_DIR%\server.properties" >nul
)

echo [4/6] Server files look good.

:: ---------------------------
:: 5) Install Node dependencies
:: ---------------------------
if exist "%BOT_DIR%\package.json" (
    echo [5/6] Installing bot dependencies...
    cd /d "%BOT_DIR%"
    call npm install
)

if exist "%MANAGER_DIR%\package.json" (
    echo [5/6] Installing manager dependencies...
    cd /d "%MANAGER_DIR%"
    call npm install
)

:: ---------------------------
:: 6) Create a simple .env template if missing
:: ---------------------------
if not exist "%BOT_DIR%\.env" (
    echo [6/6] Creating a sample .env file for the bot.
    (
        echo # Copy and fill in your real Discord values before using the bot
        echo TOKEN=your-bot-token-here
        echo GUILD_ID=your-discord-server-id
        echo CLIENT_ID=your-application-id
        echo SERVER_PATH=../
        echo SERVER_JAR=server.jar
        echo JAVA_PATH=C:\Program Files\Zulu\zulu-25\bin\java.exe
        echo RCON_HOST=127.0.0.1
        echo RCON_PORT=25575
        echo RCON_PASSWORD=change-this-local-password
    ) > "%BOT_DIR%\.env"
)

echo.
echo ================================
echo        SETUP COMPLETE
echo ================================
echo.
echo Your project is ready.
echo.
echo Next steps:
echo   1) Start the server: start.bat
 echo   2) Start the manager: start-manager.bat
 echo   3) Start the bot: start-bot.bat
 echo.
echo If the bot does not work yet, edit mc-bot\.env and add your Discord token.
echo.
pause
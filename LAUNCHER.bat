@echo off
:: ============================================================================
:: SHADOW MC HOST - ONE-CLICK LAUNCHER
:: ============================================================================
:: This script provides a complete one-click experience:
:: 1. Checks all prerequisites (Node.js, Java 25+, Git)
:: 2. Auto-installs missing dependencies
:: 3. Auto-downloads PaperMC server if missing
:: 4. Auto-creates server directory and config files
:: 5. Installs npm dependencies
:: 6. Launches the manager UI
:: ============================================================================

setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "MANAGER_DIR=%ROOT%manager"
set "BOT_DIR=%ROOT%mc-bot"
set "JAVA_INSTALL_PATH=C:\Program Files\Zulu\zulu-25"
set "PAPERMC_URL=https://papermc.io/api/v2/projects/paper/versions/1.21.4/builds/191/downloads/paper-1.21.4-191.jar"
set "PAPERMC_JAR=paper-1.21.4-191.jar"

:: Color codes for output
for /f "tokens=1,2 delims=#" %%a in ('"prompt #$H#$E# & echo on & for %%b in (1) do rem"') do set "DEL=%%b"
call :ColorText 0A "================================================" 
echo.
call :ColorText 0A "       SHADOW MC HOST - ONE-CLICK LAUNCHER       " 
call :ColorText 0A "================================================"
echo.

:: ============================================================================
:: STEP 0: Check if already set up and running
:: ============================================================================
call :CheckIfRunning
if %ALREADY_RUNNING%==1 (
    call :ColorText 0E "Manager is already running!"
    echo.
    exit /b 0
)

:: ============================================================================
:: STEP 1: Install Node.js if missing
:: ============================================================================
call :ColorText 03 "[1/7] Checking Node.js..."
where node >nul 2>&1
if errorlevel 1 (
    call :ColorText 0E "Node.js not found. Installing..."
    call :InstallNodeJS
    if errorlevel 1 (
        call :ColorText 0C "ERROR: Failed to install Node.js"
        echo Please install Node.js LTS from https://nodejs.org/
        pause
        exit /b 1
    )
) else (
    call :ColorText 0A "Node.js found!"
    for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
    call :ColorText 07 "Version: %NODE_VERSION%"
)
echo.

:: ============================================================================
:: STEP 2: Install Java 25 if missing
:: ============================================================================
call :ColorText 03 "[2/7] Checking Java 25+..."
call :CheckJavaVersion
if %JAVA_OK%==0 (
    call :ColorText 0E "Java 25+ not found. Installing Azul Zulu JDK 25..."
    call :InstallJava
    if errorlevel 1 (
        call :ColorText 0C "ERROR: Failed to install Java 25"
        echo Please install Java 25+ from https://www.azul.com/downloads/
        pause
        exit /b 1
    )
) else (
    call :ColorText 0A "Java 25+ found!"
)
echo.

:: ============================================================================
:: STEP 3: Create server directory and download PaperMC
:: ============================================================================
call :ColorText 03 "[3/7] Setting up Minecraft server..."
if not exist "%SERVER_DIR%" (
    mkdir "%SERVER_DIR%"
    call :ColorText 0A "Created server directory"
)

if not exist "%SERVER_DIR%\%PAPERMC_JAR%" (
    if not exist "%SERVER_DIR%\server.jar" (
        call :ColorText 0E "Downloading PaperMC server..."
        call :DownloadFile "%PAPERMC_URL%" "%SERVER_DIR%\%PAPERMC_JAR%"
        if exist "%SERVER_DIR%\%PAPERMC_JAR%" (
            ren "%SERVER_DIR%\%PAPERMC_JAR%" "server.jar"
            call :ColorText 0A "PaperMC server downloaded!"
        ) else (
            call :ColorText 0E "Failed to download PaperMC"
            call :ColorText 07 "Please manually download server.jar from https://papermc.io/downloads"
            pause
            exit /b 1
        )
    ) else (
        call :ColorText 0A "server.jar already exists"
    )
) else (
    call :ColorText 0A "server.jar already exists"
)

:: Create eula.txt if missing
if not exist "%SERVER_DIR%\eula.txt" (
    echo eula=true> "%SERVER_DIR%\eula.txt"
    call :ColorText 0A "Created eula.txt"
)

:: Create server.properties if missing
if not exist "%SERVER_DIR%\server.properties" (
    if exist "%ROOT%server.properties" (
        copy "%ROOT%server.properties" "%SERVER_DIR%\server.properties" >nul
        call :ColorText 0A "Created server.properties"
    ) else (
        call :CreateDefaultServerProperties
        call :ColorText 0A "Created default server.properties"
    )
)
echo.

:: ============================================================================
:: STEP 4: Install npm dependencies
:: ============================================================================
call :ColorText 03 "[4/7] Installing npm dependencies..."

if exist "%BOT_DIR%\package.json" (
    cd /d "%BOT_DIR%"
    if not exist "%BOT_DIR%\node_modules" (
        call :ColorText 0E "Installing bot dependencies..."
        call npm install
        if errorlevel 1 (
            call :ColorText 0E "Warning: Bot dependencies failed to install"
        ) else (
            call :ColorText 0A "Bot dependencies installed!"
        )
    ) else (
        call :ColorText 0A "Bot dependencies already installed"
    )
)

if exist "%MANAGER_DIR%\package.json" (
    cd /d "%MANAGER_DIR%"
    if not exist "%MANAGER_DIR%\node_modules" (
        call :ColorText 0E "Installing manager dependencies..."
        call npm install
        if errorlevel 1 (
            call :ColorText 0C "ERROR: Failed to install manager dependencies"
            pause
            exit /b 1
        ) else (
            call :ColorText 0A "Manager dependencies installed!"
        )
    ) else (
        call :ColorText 0A "Manager dependencies already installed"
    )
)
echo.

:: ============================================================================
:: STEP 5: Create bot .env file if missing
:: ============================================================================
call :ColorText 03 "[5/7] Configuring Discord bot..."
if not exist "%BOT_DIR%\.env" (
    call :CreateBotEnv
    call :ColorText 0A ".env file created"
) else (
    call :ColorText 0A ".env file already exists"
)
echo.

:: ============================================================================
:: STEP 6: Update manager servers.json with correct paths
:: ============================================================================
call :ColorText 03 "[6/7] Configuring server profiles..."
call :UpdateServersConfig
call :ColorText 0A "Server profiles configured!"
echo.

:: ============================================================================
:: STEP 7: Launch the manager
:: ============================================================================
call :ColorText 03 "[7/7] Launching SHADOW MC HOST Manager..."
echo.
call :ColorText 0A "================================================"
call :ColorText 0A "       ALL SYSTEMS READY - STARTING MANAGER    "
call :ColorText 0A "================================================"
echo.
cd /d "%MANAGER_DIR%"
start "" "%MANAGER_DIR%\node_modules\.bin\electron.cmd" .

echo.
call :ColorText 0A "Manager launched! It may take a few seconds to appear."
call :ColorText 07 "You can now:"
call :ColorText 07 "  1. Click 'Start Server' in the Dashboard"
call :ColorText 07 "  2. Configure Discord bot token in Settings"
call :ColorText 07 "  3. Use the Console to monitor server output"
echo.

:: Wait a moment then open browser to documentation
timeout /t 5 /nobreak >nul
start "" "https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST"

exit /b 0

:: ============================================================================
:: FUNCTIONS
:: ============================================================================

:ColorText
set "param= %*"
set "param=!param: =~"
for /f "tokens=1,* delims=~" %%a in (!param!) do (
    set "color=%%a"
    set "text=%%b"
)
<nul set /p "=." > "%temp%\color.tmp"
if exist "%temp%\color.tmp" del "%temp%\color.tmp"
if "%color%"=="" (
    echo %text%
) else (
    <nul set /p "=%DEL%" > "%temp%\color.tmp"
    if exist "%temp%\color.tmp" (
        <nul set /p "=!color!" > "%temp%\color.tmp"
        <nul set /p "=%text%" >> "%temp%\color.tmp"
        type "%temp%\color.tmp"
        del "%temp%\color.tmp"
    )
)
goto :eof

:CheckIfRunning
set ALREADY_RUNNING=0
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq electron.exe" /NH /FO CSV') do (
    for /f "delims=," %%i in ("%%p") do (
        set "pid=%%~i"
        set "pid=!pid:"=!"
        if "!pid!" neq "" (
            set ALREADY_RUNNING=1
            goto :eof
        )
    )
)
goto :eof

:CheckJavaVersion
set JAVA_OK=0
where java >nul 2>&1
if errorlevel 1 (
    goto :eof
)
for /f "tokens=3" %%v in ('java -version 2^>^&1 ^| findstr /R /C:"version \"[2-9][0-9]""') do (
    set "java_ver=%%v"
    set "java_ver=!java_ver:"=!"
    set "java_ver=!java_ver:version=!"
    set "java_ver=!java_ver: =!"
    if "!java_ver!" geq "25" (
        set JAVA_OK=1
    )
)
goto :eof

:InstallNodeJS
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e >nul 2>&1
if errorlevel 1 (
    exit /b 1
)
goto :eof

:InstallJava
winget install --id Azul.Zulu.25.JDK --accept-source-agreements --accept-package-agreements -e >nul 2>&1
if errorlevel 1 (
    exit /b 1
)
set "JAVA_HOME=%JAVA_INSTALL_PATH%"
set "PATH=%JAVA_HOME%\bin;%PATH%"
goto :eof

:DownloadFile
set "url=%~1"
set "dest=%~2"
powershell -Command "(New-Object Net.WebClient).DownloadFile('%url%', '%dest%')" >nul 2>&1
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

:CreateBotEnv
(
    echo # Discord Bot Configuration
    echo # Get your token from: https://discord.com/developers/applications
    echo TOKEN=your-bot-token-here
    echo GUILD_ID=your-server-id-here
    echo CLIENT_ID=your-application-id-here
    echo SERVER_PATH=../
    echo SERVER_JAR=server.jar
    echo JAVA_PATH=C:\Program Files\Zulu\zulu-25\bin\java.exe
    echo RCON_HOST=127.0.0.1
    echo RCON_PORT=25575
    echo RCON_PASSWORD=change-this-local-password
) > "%BOT_DIR%\.env"
goto :eof

:UpdateServersConfig
if not exist "%MANAGER_DIR%\servers.json" (
    (
        echo {
        echo   "servers": {
        echo     "default": {
        echo       "name": "Main Server",
        echo       "rootPath": "..\\server",
        echo       "botDir": "..\\mc-bot",
        echo       "serverJar": "server.jar",
        echo       "javaPath": null,
        echo       "rconHost": "127.0.0.1",
        echo       "rconPort": 25575,
        echo       "rconPassword": "",
        echo       "autoStart": false,
        echo       "maxRam": "4G",
        echo       "notes": "Primary Minecraft server"
        echo     }
        echo   },
        echo   "settings": {
        echo     "defaultServer": "default",
        echo     "showTerminal": false,
        echo     "closeToTray": true,
        echo     "autoStartDefaultServer": false,
        echo     "autoStartDefaultBot": false
        echo   }
        echo }
    ) > "%MANAGER_DIR%\servers.json"
) else (
    :: Update existing config with correct server path
    powershell -Command "$json = Get-Content '%MANAGER_DIR%\servers.json' -Raw | ConvertFrom-Json; $json.servers.default.rootPath = '..\server'; $json | ConvertTo-Json -Depth 10 | Out-File '%MANAGER_DIR%\servers.json'" >nul 2>&1
)
goto :eof

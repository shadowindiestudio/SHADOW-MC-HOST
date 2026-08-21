@echo off
echo ================================
echo       MINECRAFT SERVER SETUP
echo ================================
echo.

:: Check for Node.js
echo Checking Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed! Opening download page...
    start https://nodejs.org
    pause
    exit /b
)
echo Node.js found: 
node -v

:: Check for Java
echo Checking Java...
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo Java is not installed! Opening download page...
    echo Please install Eclipse Temurin JDK 21 LTS
    start https://adoptium.net/temurin/releases/?version=21
    echo After installing Java, re-run this setup.bat
    pause
    exit /b
)
echo Java found:
java -version

:: Check for Git (optional, just warn)
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Git not found - skipping. Not required but recommended.
) else (
    echo Git found:
    git --version
)

echo.
echo All dependencies verified!
echo.

:: Install bot dependencies
echo Installing bot dependencies...
cd /d "%~dp0mc-bot"
call npm install

:: Install manager dependencies
echo Installing manager dependencies...
cd /d "%~dp0manager"
call npm install

:: Register slash commands
echo Registering Discord slash commands...
cd /d "%~dp0mc-bot" && node deploy-commands.js

:: Do not accept the Minecraft EULA automatically.
cd /d "%~dp0"
echo eula=false> eula.txt

echo.
echo ================================
echo         SETUP COMPLETE
echo ================================
echo Java        : installed
echo Node.js     : installed
echo Bot deps    : installed
echo Manager     : installed
echo EULA        : review eula.txt and accept manually
echo ================================
echo Review the Minecraft EULA, then set eula=true in eula.txt before starting.
echo Run start-manager.bat to launch the dashboard.
echo Run start-bot.bat to launch the Discord bot.
echo ================================
pause
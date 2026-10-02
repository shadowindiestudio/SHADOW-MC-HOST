@echo off
cd /d "%~dp0"
set "SERVER_DIR="
for /f "usebackq delims=" %%D in (`node -e "process.stdout.write(require('./manager/paths').getNewServerDir('default'))" 2^>nul`) do set "SERVER_DIR=%%D"
if not defined SERVER_DIR (
  echo Unable to resolve the external server directory. Install Node.js and run setup first.
  pause
  exit /b 1
)
set "JAVA_HOME=C:\Program Files\Zulu\zulu-25"
set "PATH=%JAVA_HOME%\bin;%PATH%"

if not exist "%SERVER_DIR%\server.jar" (
  echo Missing "%SERVER_DIR%\server.jar". Create or import a server through SHADOW MC HOST.
  pause
  exit /b 1
)

echo eula=true> "%SERVER_DIR%\eula.txt"
cd /d "%SERVER_DIR%"
java -Xms1G -Xmx2G -jar server.jar nogui
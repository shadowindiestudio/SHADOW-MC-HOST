@echo off
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Zulu\zulu-25"
set "PATH=%JAVA_HOME%\bin;%PATH%"

if not exist "server\server.jar" (
  echo Missing server\server.jar. Place the Paper server JAR in the server folder.
  pause
  exit /b 1
)

echo eula=true> "server\eula.txt"
cd /d "%~dp0server"
java -Xms1G -Xmx2G -jar server.jar nogui

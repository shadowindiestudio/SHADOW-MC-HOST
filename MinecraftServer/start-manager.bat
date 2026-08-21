@echo off
cd /d "%~dp0manager"
start "" "node_modules\electron\dist\electron.exe" .
exit

@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  echo Download Node.js from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting Jack Studio Admin...
start "" "http://localhost:3000/admin"
node server.mjs
pause

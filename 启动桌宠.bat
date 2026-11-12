@echo off
rem Shiba Island desktop pet launcher (double-click to run)
cd /d "%~dp0"

if not exist node_modules (
  echo [pet] node_modules not found, running npm install ...
  call npm install
  if errorlevel 1 goto :fail
)

echo [pet] starting desktop pet, close the pet from its tray icon ...
call npm run pet
if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo [pet] failed, see the messages above.
pause

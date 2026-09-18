@echo off
setlocal
cd /d "%~dp0"
title Shelf Sorter - Windows setup
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/en/download first.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo This app requires Node.js 22 or newer. Install Node.js 24 LTS.
  pause
  exit /b 1
)
if exist "data\shelfSorter.db" goto install
if exist "masterAlbums.db" goto install
echo Copy masterAlbums.db into this folder, then run setup again.
echo To transfer existing progress, copy your shelfSorter.db into the data folder instead.
pause
exit /b 1
:install
call npm ci
if errorlevel 1 goto failed
if exist "data\shelfSorter.db" goto shortcut
node db\importMasterAlbums.js "masterAlbums.db"
if errorlevel 1 goto failed
:shortcut
node scripts\create-desktop-shortcut.js
if errorlevel 1 goto failed
echo.
echo Setup complete. Open Shelf Sorter from your desktop.
echo Keep this folder in place; the shortcut points here.
pause
exit /b 0
:failed
echo.
echo Setup could not finish. Read the error above.
pause
exit /b 1

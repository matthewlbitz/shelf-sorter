@echo off
setlocal
cd /d "%~dp0"
title KTRU Shelf Sorter
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS, then open this shortcut again.
  pause
  exit /b 1
)
if not exist "node_modules\better-sqlite3\package.json" (
  echo Run Setup Windows.cmd first.
  pause
  exit /b 1
)
node scripts\desktop.js
if errorlevel 1 pause

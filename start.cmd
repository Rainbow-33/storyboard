@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   分镜台启动中...
echo.
node server.mjs
if errorlevel 1 pause

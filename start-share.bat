@echo off
setlocal
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=3000
echo.
echo 台股月營收追蹤正在啟動...
echo.
node server.js
echo.
echo 如果上方出現錯誤，請確認這台電腦已安裝 Node.js 18 以上。
pause

@echo off
echo ============================================
echo  BI iPVMS - 啟動所有服務
echo ============================================
echo.
echo [1] 啟動 Python 後端 (port 8000)...
start "BI Backend" cmd /k "cd /d "%~dp0bi-backend" && python -m uvicorn main:app --reload --port 8000"

echo [2] 等待後端啟動...
timeout /t 3 /nobreak > nul

echo [3] 啟動 BI 前端 (port 5174)...
start "BI Frontend" cmd /k "cd /d "%~dp0abc-bi-app-chinese" && npm run dev"

echo.
echo ============================================
echo  後端: http://localhost:8000
echo  前端: http://localhost:5174
echo ============================================
echo.
echo 按任意鍵關閉此視窗 (後端和前端繼續運行)
pause > nul

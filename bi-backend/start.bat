@echo off
echo Starting BI Excel Parser backend on http://localhost:8000
echo.
cd /d "%~dp0"
python -m uvicorn main:app --reload --port 8000
pause

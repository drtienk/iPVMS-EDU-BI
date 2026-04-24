# PowerShell startup script for BI frontend + backend

Write-Host "========================================"
Write-Host "  BI iPVMS - Starting Backend + Frontend"
Write-Host "========================================"
Write-Host ""

# Start Python backend
Write-Host "[1] Starting Python backend (port 8000)..."
$backendPath = "$PSScriptRoot\bi-backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; python -m uvicorn main:app --port 8000 --log-level warning"
Start-Sleep -Seconds 3

# Start frontend
Write-Host "[2] Starting frontend (port 5174)..."
$frontendPath = "$PSScriptRoot\abc-bi-app-chinese"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendPath'; npm run dev"

Write-Host ""
Write-Host "========================================"
Write-Host "  Backend: http://localhost:8000"
Write-Host "  Frontend: http://localhost:5174"
Write-Host "========================================"
Write-Host ""
Write-Host "Opening frontend in browser..."
Start-Sleep -Seconds 2
Start-Process "http://localhost:5174"

"""
BI FastAPI backend — replaces browser-side XLSX.js parsing
Run: uvicorn main:app --reload --port 8000
"""
import time
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from parse_excel import parse_excel_bytes

app = FastAPI(title="BI Excel Parser", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/parse")
async def parse_excel(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    t0 = time.perf_counter()
    data = await file.read()
    t1 = time.perf_counter()

    try:
        result = parse_excel_bytes(data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Parse error: {e}")

    elapsed = time.perf_counter() - t0
    size_mb = len(data) / 1_048_576
    print(f"[parse] {file.filename}  {size_mb:.1f} MB  read={t1-t0:.2f}s  total={elapsed:.2f}s  periods={result['periodNos']}")

    return JSONResponse(content=result)

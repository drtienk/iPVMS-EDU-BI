"""Test the running API server"""
import requests, time, sys

files_to_test = [
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult 042026 1343.xlsx",
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult-中文SAMPLE.xlsx",
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult 3~5月-3 sent.xlsx",
]

for path in files_to_test:
    fname = path.split("\\")[-1]
    t0 = time.perf_counter()
    with open(path, "rb") as f:
        resp = requests.post("http://localhost:8000/api/parse", files={"file": (fname, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    elapsed = time.perf_counter() - t0

    if resp.status_code != 200:
        print(f"ERR {fname}: HTTP {resp.status_code} — {resp.text[:200]}")
        continue

    d = resp.json()
    cpr = d["normalizedData"].get("CustomerProfitResult", [])
    inc = d["normalizedData"].get("IncomeStatment", [])
    ok_sheets = sum(1 for v in d["sheetStatus"].values() if v)

    print(f"OK  {fname}")
    print(f"    {elapsed:.2f}s  periods={d['periodNos']}  sheets={ok_sheets}/8  rows={sum(len(v) for v in d['normalizedData'].values()):,}")
    if cpr:
        r = cpr[0]
        print(f"    CPR[0]: customerId={r.get('customerId')}  CustomerProfit={r.get('CustomerProfit')}  periodNo={r.get('periodNo')}")
    if inc:
        r = inc[0]
        print(f"    INC[0]: CustomersProfit={r.get('CustomersProfit')}  periodNo={r.get('periodNo')}")
    print()

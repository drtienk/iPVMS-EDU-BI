"""Quick smoke test — run: python test_parse.py"""
import sys
import time
sys.path.insert(0, ".")
from parse_excel import parse_excel_bytes

files = [
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult 042026 1343.xlsx",
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult-中文SAMPLE.xlsx",
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult 3~5月-3 sent.xlsx",
    r"E:\OneDrive\OD-2018 US\2026 vibe coding web design\BI-iPVMS\ReportResult_淨售價版本.xlsx",
]

for path in files:
    try:
        t0 = time.perf_counter()
        data = open(path, "rb").read()
        result = parse_excel_bytes(data)
        elapsed = time.perf_counter() - t0
        size_mb = len(data) / 1_048_576
        ok_sheets = sum(1 for v in result["sheetStatus"].values() if v)
        total_rows = sum(len(v) for v in result["normalizedData"].values())
        print(f"OK  {path.split(chr(92))[-1]}")
        print(f"    {size_mb:.1f} MB  {elapsed:.2f}s  periods={result['periodNos']}  sheets={ok_sheets}/8  rows={total_rows:,}")
        # Show CustomerProfitResult sample
        cpr = result["normalizedData"].get("CustomerProfitResult", [])
        if cpr:
            r = cpr[0]
            print(f"    CustomerProfitResult[0]: customerID={r.get('CustomerID') or r.get('customerId')}  profit={r.get('CustomerProfit')}  period={r.get('periodNo')}")
        # Show IncomeStatment sample
        inc = result["normalizedData"].get("IncomeStatment", [])
        if inc:
            r = inc[0]
            print(f"    IncomeStatment[0]: customersProfit={r.get('CustomersProfit')}  period={r.get('periodNo')}")
        print()
    except Exception as e:
        print(f"ERR {path.split(chr(92))[-1]}: {e}")
        print()

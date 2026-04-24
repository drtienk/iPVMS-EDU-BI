"""
Excel parsing + normalization logic — Python/pandas equivalent of
abc-bi-app-chinese/src/parseExcel.ts + normalize.ts
"""
import warnings
from typing import Any

import pandas as pd

# Suppress harmless pandas downcasting FutureWarning
warnings.filterwarnings("ignore", category=FutureWarning, module="pandas")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_SHEETS = [
    "Resource",
    "ActivityCenter+ActivityModel",
    "ActivityDriver",
    "CustomerServiceCost",
    "IncomeStatment",
    "CustomerProfitResult",
    "ProductProfitResult",
    "CustomerProductProfit",
]

FIELD_ALIASES: dict[str, list[str]] = {
    "Year":                      ["Year", "年"],
    "Month":                     ["Month", "月份"],
    "PeriodNo":                  ["PeriodNo", "期間資料版本"],
    "Company":                   ["Company", "公司"],
    "Company Code":              ["Company Code", "公司代碼"],
    "Business Unit":             ["Business Unit", " Business Unit", "事業單位"],
    "Business Unit Code":        ["Business Unit Code", " Business Unit Code", "事業單位代碼"],
    "CustomerID":                ["CustomerID", "顧客代碼"],
    "Customer":                  ["Customer", "顧客"],
    "CustomerProfit":            ["CustomerProfit", "客戶利潤"],
    "CustomersProfit":           ["CustomersProfit", "客戶利潤"],
    "ProductProfit":             ["ProductProfit", "產品利潤"],
    "Price":                     ["Price", "銷貨收入"],
    "ManufactureCost":           ["ManufactureCost", "製造成本"],
    "SalesProfit":               ["SalesProfit", "銷貨毛利"],
    "ManagementCost":            ["ManagementCost", "銷貨作業成本"],
    "ServiceCost":               ["ServiceCost", "資源直歸客戶成本"],
    "TotalCost":                 ["TotalCost", "總銷貨成本"],
    "CustomerProfitRatio":       ["CustomerProfitRatio", "客戶利潤率"],
    "ProductProfitRatio":        ["ProductProfitRatio", "產品利潤率"],
    "SalesVolume":               ["SalesVolume", "銷售數量"],
    "UnitPrice":                 ["UnitPrice", "平均銷貨單價"],
    "ProductUnitCost":           ["ProductUnitCost", "平均產品單位成本"],
    "Activity Center":           ["Activity Center", " Activity Center", "作業中心"],
    "Activity Center Code":      ["Activity Center Code", "作業中心代碼"],
    "Activity Center- Level 2":  ["Activity Center- Level 2", " Activity Center- Level 2", "作業中心-第二階"],
    "Activity - Level 2":        ["Activity - Level 2", " Activity - Level 2", "作業-第二階"],
    "Amount":                    ["Amount", "金額"],
    "NetProfit":                 ["NetProfit", "淨利率"],
    "ActCost":                   ["ActCost", "實際產能費率成本"],
    "StdCost":                   ["StdCost", "正常產能費率成本"],
    "ValueObject":               ["ValueObject", "價值標的"],
    "ProductID":                 ["ProductID", "產品代碼"],
    "Code":                      ["Code", "作業動因"],
}

# reverse lookup: alias → canonical English name
_ALIAS_TO_CANONICAL: dict[str, str] = {}
for _canon, _aliases in FIELD_ALIASES.items():
    for _alias in _aliases:
        if _alias not in _ALIAS_TO_CANONICAL:
            _ALIAS_TO_CANONICAL[_alias] = _canon

REQUIRED_COLUMNS: dict[str, list[str]] = {
    "CustomerProfitResult":         ["CustomerID", "PeriodNo", "CustomerProfit"],
    "CustomerProductProfit":        ["Customer", "PeriodNo", "NetProfit"],
    "CustomerServiceCost":          ["Customer", "PeriodNo", "Activity Center", "Amount"],
    "ActivityDriver":               ["Activity Center", "PeriodNo", "ValueObject", "ActCost"],
    "ActivityCenter+ActivityModel": ["Activity Center- Level 2", "PeriodNo", "Amount"],
    "Resource":                     ["Activity Center", "PeriodNo", "Amount"],
    "IncomeStatment":               ["Year", "Month"],
    "ProductProfitResult":          ["ProductID", "PeriodNo"],
}

AMOUNT_FIELDS = [
    "Amount", "ActCost", "StdCost", "Price", "ServiceCost", "CustomerProfit",
    "NetProfit", "TotalCost", "ManagementCost", "ManufactureCost", "SalesProfit",
    "GrossMargin", "ProjectCost", "NetIncome", "ProductCost", "ServiceAmount",
    "VC_ServiceCost", "CustomersProfit", "ProductProfit", "ResourceDriverValue",
    "ActvivtyDriverValue", "ActivityCenterDriverRate", "ActivityCenterDriverValue",
    "DriverValue", "ServiceDriverValue", "CustomerProfitRatio", "ProductProfitRatio",
    "Quantity", "SalesVolume", "UnitPrice", "ProductUnitCost", "Ratio",
]

RATIO_FIELDS = {"CustomerProfitRatio", "ProductProfitRatio", "Ratio"}

# ---------------------------------------------------------------------------
# Column normalisation helpers
# ---------------------------------------------------------------------------

def _get_field(row: dict, field: str) -> Any:
    """Return value for field, checking all aliases."""
    aliases = FIELD_ALIASES.get(field, [field])
    for alias in aliases:
        if alias in row:
            return row[alias]
    return None


def _extract_id(value: Any) -> str:
    if value is None or value == "":
        return ""
    s = str(value).strip()
    return s.split(":")[0] if ":" in s else s


def _extract_code(value: Any) -> str:
    return _extract_id(value)


def _extract_bu_code(value: Any) -> str:
    return _extract_id(value)


def _to_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_number_or_none(value: Any):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# DataFrame column normalisation
# ---------------------------------------------------------------------------

def _rename_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Strip whitespace and map Chinese / aliased column names to canonical English."""
    rename_map: dict[str, str] = {}
    seen_targets: set[str] = set()

    for col in df.columns:
        stripped = str(col).strip()
        canonical = _ALIAS_TO_CANONICAL.get(stripped, stripped)
        if canonical == stripped:
            # already canonical (or unknown) – still strip whitespace
            rename_map[col] = stripped
        else:
            if canonical not in seen_targets:
                rename_map[col] = canonical
                seen_targets.add(canonical)
            else:
                # second alias for same canonical → keep original (already mapped)
                rename_map[col] = stripped

    return df.rename(columns=rename_map)


def _is_sheet_valid(sheet_name: str, df: pd.DataFrame) -> bool:
    if df.empty:
        return False
    required = REQUIRED_COLUMNS.get(sheet_name, [])
    actual = set(df.columns.tolist())
    # check each required col — accept any alias
    for col in required:
        aliases = FIELD_ALIASES.get(col, [col])
        if not any(a in actual for a in aliases):
            return False
    return True


# ---------------------------------------------------------------------------
# Normalised field computation (vectorised where possible)
# ---------------------------------------------------------------------------

def _compute_period_no(df: pd.DataFrame) -> pd.Series:
    """Return a Series of integer periodNo values for each row."""
    if "PeriodNo" in df.columns:
        nums = pd.to_numeric(df["PeriodNo"], errors="coerce")
        valid = nums.notna() & (nums != 0)
        result = nums.where(valid, other=pd.NA)
    else:
        result = pd.Series(pd.NA, index=df.index)

    # Fallback: Year*100 + Month if PeriodNo is missing
    if "Year" in df.columns and "Month" in df.columns:
        year = pd.to_numeric(df["Year"], errors="coerce")
        month = pd.to_numeric(df["Month"], errors="coerce")
        ym = (year * 100 + month).where(year.notna() & month.notna() & (year > 0) & (month > 0))
        result = result.where(result.notna(), other=ym)

    return result.fillna(0).infer_objects(copy=False).astype(int)


def _compute_company(df: pd.DataFrame) -> pd.Series:
    if "Company" in df.columns:
        return df["Company"].fillna("").astype(str).str.strip()
    if "Company Code" in df.columns:
        return df["Company Code"].fillna("").astype(str).str.strip()
    return pd.Series("", index=df.index)


def _compute_bu_code(df: pd.DataFrame, table_name: str) -> pd.Series:
    if table_name == "CustomerProductProfit" and "Business Unit Code" in df.columns:
        return df["Business Unit Code"].fillna("").astype(str).str.strip().apply(
            lambda v: v.split(":")[0] if ":" in v else v
        )
    if "Business Unit" in df.columns:
        return df["Business Unit"].fillna("").astype(str).str.strip().apply(
            lambda v: v.split(":")[0] if ":" in v else v
        )
    return pd.Series("", index=df.index)


def _compute_customer_id(df: pd.DataFrame, table_name: str) -> pd.Series:
    def _extract(s: Any) -> str:
        s = str(s).strip()
        return s.split(":")[0] if ":" in s else s

    if table_name == "CustomerProfitResult":
        if "CustomerID" in df.columns:
            return df["CustomerID"].fillna("").astype(str).str.strip()
        return pd.Series("", index=df.index)

    if table_name in ("CustomerServiceCost", "CustomerProductProfit"):
        if "Customer" in df.columns:
            return df["Customer"].fillna("").astype(str).apply(_extract)
        return pd.Series("", index=df.index)

    if table_name == "ActivityDriver":
        if "ValueObject" in df.columns:
            return df["ValueObject"].fillna("").astype(str).apply(_extract)
        return pd.Series("", index=df.index)

    if table_name == "IncomeStatment":
        if "Customer" in df.columns:
            return df["Customer"].fillna("").astype(str).str.strip()
        return pd.Series("", index=df.index)

    return pd.Series("", index=df.index)


def _compute_activity_center_key(df: pd.DataFrame, table_name: str) -> pd.Series:
    def _col(name: str) -> pd.Series:
        if name in df.columns:
            return df[name].fillna("").astype(str).str.strip()
        return pd.Series("", index=df.index)

    if table_name in ("CustomerServiceCost", "ActivityDriver", "Resource"):
        return _col("Activity Center")
    if table_name == "ActivityCenter+ActivityModel":
        return _col("Activity Center- Level 2")
    if table_name == "IncomeStatment":
        return _col("Activity Center Code")
    if table_name == "CustomerProductProfit":
        return _col("SalesActivityCenter")
    return pd.Series("", index=df.index)


def _compute_activity_code_key(df: pd.DataFrame, table_name: str) -> pd.Series:
    def _extract_code_col(col: str) -> pd.Series:
        if col in df.columns:
            return df[col].fillna("").astype(str).apply(
                lambda v: v.strip().split(":")[0] if ":" in v else v.strip()
            )
        return pd.Series("", index=df.index)

    if table_name == "CustomerServiceCost":
        return _extract_code_col("Code")
    if table_name in ("ActivityDriver", "ActivityCenter+ActivityModel"):
        return _extract_code_col("Activity - Level 2")
    return pd.Series("", index=df.index)


def _normalize_amounts(df: pd.DataFrame) -> pd.DataFrame:
    for col in AMOUNT_FIELDS:
        if col in df.columns:
            nums = pd.to_numeric(df[col], errors="coerce")
            if col in RATIO_FIELDS:
                df[col] = nums  # keep NaN for ratios
            else:
                df[col] = nums.fillna(0.0)
    return df


def _add_normalized_fields(df: pd.DataFrame, table_name: str) -> pd.DataFrame:
    df = df.copy()
    df["periodNo"] = _compute_period_no(df)
    df["company"] = _compute_company(df)
    df["buCode"] = _compute_bu_code(df, table_name)
    df["customerId"] = _compute_customer_id(df, table_name)
    df["activityCenterKey"] = _compute_activity_center_key(df, table_name)
    df["activityCodeKey"] = _compute_activity_code_key(df, table_name)
    return df


def _normalize_sheet(df: pd.DataFrame, table_name: str) -> pd.DataFrame:
    df = _rename_columns(df)
    df = _normalize_amounts(df)
    df = _add_normalized_fields(df, table_name)
    return df


# ---------------------------------------------------------------------------
# Period extraction
# ---------------------------------------------------------------------------

def _extract_period_nos(sheets: dict[str, pd.DataFrame]) -> list[int]:
    period_set: set[int] = set()

    for name in REQUIRED_SHEETS:
        if name == "IncomeStatment":
            continue
        df = sheets.get(name)
        if df is None or df.empty:
            continue
        if "periodNo" in df.columns:
            vals = pd.to_numeric(df["periodNo"], errors="coerce").dropna().astype(int)
            period_set.update(vals[vals != 0].tolist())

    income = sheets.get("IncomeStatment")
    if income is not None and not income.empty:
        if "periodNo" in income.columns:
            vals = pd.to_numeric(income["periodNo"], errors="coerce").dropna().astype(int)
            period_set.update(vals[vals != 0].tolist())

    return sorted(period_set)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _read_all_sheets(data: bytes) -> dict[str, pd.DataFrame]:
    """
    Read all required sheets in a single file open.
    Uses pd.ExcelFile so we open the zip once and parse each sheet in turn.
    Tries calamine (fast Rust engine) first, falls back to openpyxl.
    Missing sheets are silently skipped.
    """
    buf = pd.io.common.BytesIO(data)
    engine = "calamine"
    try:
        xl = pd.ExcelFile(buf, engine=engine)
    except Exception:
        buf.seek(0)
        engine = "openpyxl"
        xl = pd.ExcelFile(buf, engine=engine)

    available = set(xl.sheet_names)
    result: dict[str, pd.DataFrame] = {}
    for name in REQUIRED_SHEETS:
        if name not in available:
            continue
        try:
            df = xl.parse(name, dtype=str)  # str preserves leading zeros in IDs
            result[name] = df
        except Exception:
            pass
    xl.close()
    return result


def parse_excel_bytes(data: bytes) -> dict:
    """
    Parse an Excel workbook from raw bytes.
    Returns a dict matching the TypeScript ParseResult shape:
      { periodNos, sheetStatus, normalizedData }
    where normalizedData[sheetName] is a list of row-dicts.
    """
    # Read all required sheets in ONE file open (much faster than 8 separate reads)
    raw_sheets = _read_all_sheets(data)

    # Validate and normalise
    sheet_status: dict[str, bool] = {}
    normalized: dict[str, pd.DataFrame] = {}

    for name in REQUIRED_SHEETS:
        df = raw_sheets.get(name)
        if df is None or df.empty:
            sheet_status[name] = False
            normalized[name] = pd.DataFrame()
            continue

        df_renamed = _rename_columns(df)
        sheet_status[name] = _is_sheet_valid(name, df_renamed)
        normalized[name] = _normalize_sheet(df, name)

    # Extract period numbers
    period_nos = _extract_period_nos(normalized)

    # Convert DataFrames to list-of-dicts for JSON serialisation
    def df_to_records(df: pd.DataFrame) -> list[dict]:
        import math
        if df.empty:
            return []
        # Replace NaN/Inf/NaT with None so json.dumps doesn't choke
        df2 = df.replace([float("inf"), float("-inf")], None)
        records = df2.where(pd.notnull(df2), other=None).to_dict(orient="records")
        # Convert numpy int/float → Python native; sanitise Inf/NaN
        cleaned = []
        for rec in records:
            row: dict[str, Any] = {}
            for k, v in rec.items():
                if hasattr(v, "item"):        # numpy scalar → Python
                    v = v.item()
                if isinstance(v, float) and not math.isfinite(v):
                    v = None
                row[k] = v
            cleaned.append(row)
        return cleaned

    normalized_data = {name: df_to_records(normalized[name]) for name in REQUIRED_SHEETS}

    return {
        "periodNos": period_nos,
        "sheetStatus": sheet_status,
        "normalizedData": normalized_data,
    }

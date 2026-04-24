import * as XLSX from 'xlsx';
import type { TableName, NormalizedData } from './types';
import { normalizeAll } from './normalize';

/** Python FastAPI backend URL — must be running for large file support */
const BACKEND_URL = 'http://localhost:8000';

const REQUIRED_SHEETS: TableName[] = [
  'Resource',
  'ActivityCenter+ActivityModel',
  'ActivityDriver',
  'CustomerServiceCost',
  'IncomeStatment',
  'CustomerProfitResult',
  'ProductProfitResult',
  'CustomerProductProfit',
];

/** 欄位別名對應表 (英文 → 中文) */
const FIELD_ALIASES: Record<string, string[]> = {
  'Year': ['Year', '年'],
  'Month': ['Month', '月份'],
  'PeriodNo': ['PeriodNo', '期間資料版本'],
  'Company': ['Company', '公司'],
  'Company Code': ['Company Code', '公司代碼'],
  'Business Unit': ['Business Unit', ' Business Unit', '事業單位'],
  'Business Unit Code': ['Business Unit Code', ' Business Unit Code', '事業單位代碼'],
  'CustomerID': ['CustomerID', '顧客代碼'],
  'Customer': ['Customer', '顧客'],
  'CustomerProfit': ['CustomerProfit', '客戶利潤'],
  'CustomersProfit': ['CustomersProfit', '客戶利潤'],
  'ProductProfit': ['ProductProfit', '產品利潤'],
  'Price': ['Price', '銷貨收入', '金額'],
  'ManufactureCost': ['ManufactureCost', '製造成本'],
  'SalesProfit': ['SalesProfit', '銷貨毛利'],
  'ManagementCost': ['ManagementCost', '銷貨作業成本'],
  'ServiceCost': ['ServiceCost', '資源直歸客戶成本'],
  'TotalCost': ['TotalCost', '總銷貨成本'],
  'CustomerProfitRatio': ['CustomerProfitRatio', '客戶利潤率'],
  'ProductProfitRatio': ['ProductProfitRatio', '產品利潤率'],
  'SalesVolume': ['SalesVolume', '銷售數量'],
  'UnitPrice': ['UnitPrice', '平均銷貨單價'],
  'ProductUnitCost': ['ProductUnitCost', '平均產品單位成本'],
  'Activity Center': ['Activity Center', ' Activity Center', '作業中心'],
  'Activity Center Code': ['Activity Center Code', '作業中心代碼'],
  'Activity Center- Level 2': ['Activity Center- Level 2', ' Activity Center- Level 2', '作業中心-第二階'],
  'Amount': ['Amount', '金額'],
  'NetProfit': ['NetProfit', '淨利率'],
  'ActCost': ['ActCost', '實際產能費率成本'],
  'ValueObject': ['ValueObject', '價值標的'],
  'ProductID': ['ProductID', '產品代碼'],
};

const REQUIRED_COLUMNS: Record<string, string[]> = {
  CustomerProfitResult: ['CustomerID', 'PeriodNo', 'CustomerProfit'],
  CustomerProductProfit: ['Customer', 'PeriodNo', 'NetProfit'],
  CustomerServiceCost: ['Customer', 'PeriodNo', 'Activity Center', 'Amount'],
  ActivityDriver: ['Activity Center', 'PeriodNo', 'ValueObject', 'ActCost'],
  'ActivityCenter+ActivityModel': ['Activity Center- Level 2', 'PeriodNo', 'Amount'],
  Resource: ['Activity Center', 'PeriodNo', 'Amount'],
  IncomeStatment: ['Year', 'Month'],
  ProductProfitResult: ['ProductID', 'PeriodNo'],
};

const trimKeys = (row: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmedKey = key.trim();
    result[trimmedKey] = value;
    // 如果是中文欄位，也添加英文別名以相容後續邏輯
    for (const [enField, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(trimmedKey) && trimmedKey !== enField) {
        result[enField] = value;
      }
    }
  }
  return result;
};

function isSheetValid(sheetName: string, rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const requiredCols = REQUIRED_COLUMNS[sheetName] || [];
  const firstRow = rows[0];
  const actualCols = Object.keys(firstRow);
  return requiredCols.every((col) => {
    const aliases = FIELD_ALIASES[col] || [col];
    return aliases.some((alias) => actualCols.includes(alias));
  });
}

function sheetToRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return data.map(trimKeys);
}

/** 從有 PeriodNo 的 sheets 及 IncomeStatment 收集所有 periodNo，去重、升冪排序 */
function extractPeriodNos(parsed: Record<string, Record<string, unknown>[]>): number[] {
  const set = new Set<number>();
  for (const name of REQUIRED_SHEETS) {
    if (name === 'IncomeStatment') continue;
    const rows = parsed[name];
    if (rows && rows.length > 0) {
      for (const row of rows) {
        if (row && row['PeriodNo'] != null) {
          const n = Number(row['PeriodNo']);
          if (!isNaN(n)) set.add(n);
        }
      }
    }
  }
  const income = parsed['IncomeStatment'];
  if (income && income.length > 0) {
    for (const row of income) {
      if (row) {
        const y = Number(row['Year']);
        const m = Number(row['Month']);
        if (!isNaN(y) && !isNaN(m)) set.add(y * 100 + m);
      }
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export interface ParseResult {
  periodNos: number[];
  sheetStatus: Record<string, boolean>;
  normalizedData: NormalizedData;
}

// ---------------------------------------------------------------------------
// Backend API path (fast — uses Python/pandas)
// ---------------------------------------------------------------------------

async function parseViaBackend(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`${BACKEND_URL}/api/parse`, { method: 'POST', body: form });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Backend error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return json as ParseResult;
}

// ---------------------------------------------------------------------------
// Browser XLSX.js fallback (for small files when backend is offline)
// ---------------------------------------------------------------------------

async function parseViaBrowser(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', sheets: REQUIRED_SHEETS });
  const parsed: Record<string, Record<string, unknown>[]> = {};

  for (const sheetName of REQUIRED_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetToRows(sheet);
    if (rows.length > 0) {
      parsed[sheetName] = rows;
    }
  }

  const sheetStatus: Record<string, boolean> = {};
  for (const sheet of REQUIRED_SHEETS) {
    sheetStatus[sheet] = isSheetValid(sheet, parsed[sheet] || []);
  }

  const normalizedData = normalizeAll(parsed);
  const periodNos = extractPeriodNos(parsed);

  return { periodNos, sheetStatus, normalizedData };
}

// ---------------------------------------------------------------------------
// Public entry point — tries backend first, browser fallback for small files
// ---------------------------------------------------------------------------

export async function parseExcelFile(file: File): Promise<ParseResult> {
  // Always try the backend first (it's much faster and handles large files)
  try {
    return await parseViaBackend(file);
  } catch (backendErr) {
    // Backend not running — fall back to browser-side parsing
    // Only safe for small files (< 5 MB); larger files will likely crash the tab
    const MB = file.size / 1_048_576;
    if (MB > 5) {
      throw new Error(
        `File is ${MB.toFixed(1)} MB — too large for browser parsing.\n` +
        `Please start the Python backend:\n  cd bi-backend && start.bat\n` +
        `(Backend error: ${backendErr instanceof Error ? backendErr.message : backendErr})`
      );
    }
    console.warn('[parseExcel] Backend unavailable, falling back to browser XLSX.js:', backendErr);
    return parseViaBrowser(file);
  }
}

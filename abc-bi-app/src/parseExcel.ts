import * as XLSX from 'xlsx';
import type { TableName, NormalizedData } from './types';
import { normalizeAll } from './normalize';

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

const REQUIRED_COLUMNS: Record<string, string[]> = {
  CustomerProfitResult: ['CustomerID', 'PeriodNo', 'CustomerProfit'],
  CustomerProductProfit: ['Customer', 'PeriodNo', 'NetProfit'],
  CustomerServiceCost: ['Customer', 'PeriodNo', 'Activity Center', 'Amount'],
  ActivityDriver: ['Activity Center', 'PeriodNo', 'ValueObject', 'ActCost'],
  'ActivityCenter+ActivityModel': ['Activity Center- Level 2', 'PeriodNo', 'Amount'],
  Resource: ['Activity Center', 'PeriodNo', 'Amount'],
  IncomeStatment: ['Year', 'Month', 'Customer'],
  ProductProfitResult: ['ProductID', 'PeriodNo'],
};

const trimKeys = (row: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.trim()] = value;
  }
  return result;
};

function isSheetValid(sheetName: string, rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const requiredCols = REQUIRED_COLUMNS[sheetName] || [];
  const firstRow = rows[0];
  const actualCols = Object.keys(firstRow).map((k) => k.trim());
  return requiredCols.every((col) => actualCols.includes(col));
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

export async function parseExcelFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const parsed: Record<string, Record<string, unknown>[]> = {};

  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Sheet2' || sheetName === 'Sheet3') continue;
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

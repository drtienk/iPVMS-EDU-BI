import type { TableName, NormalizedData } from './types';

export const toNumber = (value: unknown, defaultVal: number = 0): number => {
  const num = Number(value);
  return isNaN(num) ? defaultVal : num;
};

export const toNumberOrNull = (value: unknown): number | null => {
  const num = Number(value);
  return isNaN(num) ? null : num;
};

/** 從 "1404:ErZh" 取 "1404"；純數字也轉字串 */
export const extractId = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null || value === '') return '';
  const str = String(value).trim();
  if (str.includes(':')) return str.split(':')[0];
  return str;
};

/** 從 "SD001:Therapy Meeting" 取 "SD001" */
export const extractCode = (value: string | undefined | null): string => {
  if (!value) return '';
  const str = String(value).trim();
  if (str.includes(':')) return str.split(':')[0];
  return str;
};

/** buCode: 從 "LUNA_AnCor:LUNA" 取 "LUNA_AnCor" */
export const extractBuCode = (value: string | undefined | null): string => {
  if (!value) return '';
  const str = String(value).trim();
  if (str.includes(':')) return str.split(':')[0];
  return str;
};

/** activityCenterKey: 保留完整值，只做 trim */
export const normalizeActivityCenter = (value: string | undefined | null): string => {
  if (!value) return '';
  return String(value).trim();
};

function getCompany(row: Record<string, unknown>): string {
  const v = row['Company'] ?? row['Company Code'] ?? row[' Company Code'];
  return v != null ? String(v).trim() : '';
}

function getPeriodNo(row: Record<string, unknown>, fallbackYearMonth?: { year: number; month: number }): number {
  const p = row['PeriodNo'];
  if (p !== undefined && p !== null && p !== '') {
    const n = Number(p);
    if (!isNaN(n)) return n;
  }
  if (fallbackYearMonth) {
    return fallbackYearMonth.year * 100 + fallbackYearMonth.month;
  }
  return 0;
}

function getBuCode(row: Record<string, unknown>, tableName: TableName): string {
  if (tableName === 'CustomerProductProfit') {
    const v = row[' Business Unit Code'] ?? row['Business Unit Code'];
    return extractBuCode(v != null ? String(v) : '');
  }
  const v = row[' Business Unit'] ?? row['Business Unit'];
  return extractBuCode(v != null ? String(v) : '');
}

function getCustomerId(row: Record<string, unknown>, tableName: TableName): string {
  if (tableName === 'CustomerProfitResult') {
    const v = row['CustomerID'];
    return v !== undefined && v !== null && v !== '' ? String(v) : '';
  }
  if (tableName === 'CustomerServiceCost' || tableName === 'CustomerProductProfit') {
    return extractId(row['Customer'] as string);
  }
  if (tableName === 'ActivityDriver') {
    return extractId(row['ValueObject'] as string);
  }
  if (tableName === 'IncomeStatment') {
    const v = row['Customer'];
    return v !== undefined && v !== null && v !== '' ? String(v) : '';
  }
  return '';
}

function getActivityCenterKey(row: Record<string, unknown>, tableName: TableName): string {
  if (tableName === 'CustomerServiceCost' || tableName === 'ActivityDriver' || tableName === 'Resource') {
    return normalizeActivityCenter(row[' Activity Center'] as string);
  }
  if (tableName === 'ActivityCenter+ActivityModel') {
    return normalizeActivityCenter(row[' Activity Center- Level 2'] as string);
  }
  if (tableName === 'CustomerProductProfit') {
    return normalizeActivityCenter(row['SalesActivityCenter'] as string);
  }
  return '';
}

function getActivityCodeKey(row: Record<string, unknown>, tableName: TableName): string {
  if (tableName === 'CustomerServiceCost') {
    return extractCode(row['Code'] as string);
  }
  if (tableName === 'ActivityDriver' || tableName === 'ActivityCenter+ActivityModel') {
    return extractCode((row[' Activity - Level 2'] ?? row['Activity - Level 2']) as string);
  }
  return '';
}

function addNormalizedFields<T extends Record<string, unknown>>(
  row: T,
  tableName: TableName,
  fallbackYearMonth?: { year: number; month: number }
): T & Record<string, unknown> {
  const company = getCompany(row);
  const periodNo = getPeriodNo(row, fallbackYearMonth);
  const buCode = getBuCode(row, tableName);
  const customerId = getCustomerId(row, tableName);
  const activityCenterKey = getActivityCenterKey(row, tableName);
  const activityCodeKey = getActivityCodeKey(row, tableName);
  return {
    ...row,
    periodNo,
    company,
    buCode,
    customerId,
    activityCenterKey,
    activityCodeKey,
  } as T & Record<string, unknown>;
}

function normalizeAmounts(row: Record<string, unknown>, _tableName: TableName): Record<string, unknown> {
  const out = { ...row };
  const amountKeys = ['Amount', 'ActCost', 'StdCost', 'Price', 'ServiceCost', 'CustomerProfit', 'NetProfit', 'TotalCost', 'ManagementCost', 'ManufactureCost', 'SalesProfit', 'GrossMargin', 'ProjectCost', 'NetIncome', 'ProductCost', 'ServiceAmount', 'VC_ServiceCost', 'CustomersProfit', 'ProductProfit', 'ResourceDriverValue', 'ActvivtyDriverValue', 'ActivityCenterDriverRate', 'ActivityCenterDriverValue', 'DriverValue', 'Ratio', 'ServiceDriverValue', 'CustomerProfitRatio', 'ProductProfitRatio', 'Quantity', 'SalesVolume', 'UnitPrice', 'ProductUnitCost', 'ProductProfit'];
  for (const key of amountKeys) {
    if (key in out && out[key] !== undefined && out[key] !== null && out[key] !== '') {
      const v = out[key];
      if (key === 'CustomerProfitRatio' || key === 'ProductProfitRatio' || key === 'Ratio') {
        out[key] = toNumberOrNull(v);
      } else {
        out[key] = toNumber(v, 0);
      }
    }
  }
  return out;
}

export function normalizeSheet<T extends Record<string, unknown>>(
  rows: T[],
  tableName: TableName,
  fallbackYearMonth?: { year: number; month: number }
): (T & Record<string, unknown>)[] {
  return rows.map((row) => {
    const withAmounts = normalizeAmounts(row as Record<string, unknown>, tableName) as T;
    return addNormalizedFields(withAmounts, tableName, fallbackYearMonth);
  });
}

export function normalizeAll(parsed: Record<string, Record<string, unknown>[]>): NormalizedData {
  const tables: TableName[] = [
    'Resource',
    'ActivityCenter+ActivityModel',
    'ActivityDriver',
    'CustomerServiceCost',
    'IncomeStatment',
    'CustomerProfitResult',
    'ProductProfitResult',
    'CustomerProductProfit',
  ];
  const result: NormalizedData = {} as NormalizedData;
  let fallbackYearMonth: { year: number; month: number } | undefined;
  const incomeRows = parsed['IncomeStatment'];
  if (incomeRows && incomeRows.length > 0 && incomeRows[0]) {
    const y = Number(incomeRows[0]['Year']);
    const m = Number(incomeRows[0]['Month']);
    if (!isNaN(y) && !isNaN(m)) fallbackYearMonth = { year: y, month: m };
  }
  for (const name of tables) {
    const raw = parsed[name] || [];
    result[name] = normalizeSheet(raw, name, fallbackYearMonth);
  }
  return result;
}

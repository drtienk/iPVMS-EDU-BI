import { getDb, deletePeriod as deletePeriodFromDb } from './db';
import type { PeriodInfo } from './types';
import type { TableName } from './types';

const TABLE_KEYS: TableName[] = [
  'Resource',
  'ActivityCenter+ActivityModel',
  'ActivityDriver',
  'CustomerServiceCost',
  'IncomeStatment',
  'CustomerProfitResult',
  'ProductProfitResult',
  'CustomerProductProfit',
];

export async function getAllPeriods(): Promise<PeriodInfo[]> {
  const db = await getDb();
  const list = await db.getAll('periods');
  return list.sort((a, b) => b.periodNo - a.periodNo);
}

export async function getTableData<T = unknown>(periodNo: number, tableName: TableName): Promise<T[]> {
  const db = await getDb();
  const key = `${periodNo}:${tableName}`;
  const data = await db.get('tables', key);
  return (data ?? []) as T[];
}

export async function getPeriodInfo(periodNo: number): Promise<PeriodInfo | undefined> {
  const db = await getDb();
  return db.get('periods', periodNo);
}

export async function saveUpload(periodNo: number, sheetStatus: Record<string, boolean>, normalizedData: Record<string, unknown[]>): Promise<void> {
  const db = await getDb();
  await db.put('periods', {
    periodNo,
    uploadedAt: Date.now(),
    sheetStatus,
  });
  for (const tableName of TABLE_KEYS) {
    const rows = normalizedData[tableName] ?? [];
    await db.put('tables', rows, `${periodNo}:${tableName}`);
  }
}

export async function deletePeriod(periodNo: number): Promise<void> {
  return deletePeriodFromDb(periodNo);
}

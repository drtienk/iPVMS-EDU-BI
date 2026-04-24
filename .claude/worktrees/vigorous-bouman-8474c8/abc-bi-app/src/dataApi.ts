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

/** List all period numbers (sorted ascending) for trend / multi-period views. */
export async function listPeriods(): Promise<number[]> {
  const list = await getAllPeriods();
  return list.map((p) => p.periodNo).sort((a, b) => a - b);
}

export async function getTableData<T = unknown>(periodNo: number, tableName: TableName): Promise<T[]> {
  const db = await getDb();
  const key = `${periodNo}:${tableName}`;
  const data = await db.get('tables', key);
  return (data ?? []) as T[];
}

/** Read table rows by period and table name (key: `${periodNo}:${tableName}`). */
export async function getTable<T = unknown>(periodNo: number, tableName: string): Promise<T[]> {
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
  try {
    const db = await getDb();
    console.log(`[saveUpload] Saving period ${periodNo}...`);

    await db.put('periods', {
      periodNo,
      uploadedAt: Date.now(),
      sheetStatus,
    });
    console.log(`[saveUpload] Period metadata saved for ${periodNo}`);

    for (const tableName of TABLE_KEYS) {
      const rows = normalizedData[tableName] ?? [];
      const key = `${periodNo}:${tableName}`;
      try {
        await db.put('tables', rows, key);
        console.log(`[saveUpload] Saved ${tableName} for period ${periodNo} (${rows.length} rows)`);
      } catch (err) {
        console.error(`[saveUpload] Failed to save ${tableName}:`, err);
        throw err;
      }
    }
    console.log(`[saveUpload] Period ${periodNo} completed successfully`);
  } catch (err) {
    console.error(`[saveUpload] Error for period ${periodNo}:`, err);
    throw new Error(`Failed to save period ${periodNo}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function deletePeriod(periodNo: number): Promise<void> {
  return deletePeriodFromDb(periodNo);
}

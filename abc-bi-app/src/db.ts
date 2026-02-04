import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { PeriodInfo } from './types';

export interface BIDB extends DBSchema {
  periods: {
    key: number;
    value: PeriodInfo;
  };
  tables: {
    key: string;
    value: unknown[];
  };
}

export const dbPromise = openDB<BIDB>('abc-bi-db', 1, {
  upgrade(db) {
    db.createObjectStore('periods', { keyPath: 'periodNo' });
    db.createObjectStore('tables');
  },
});

export const formatUploadedAt = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-TW');
};

export async function getDb(): Promise<IDBPDatabase<BIDB>> {
  return dbPromise;
}

/** Delete a period and all its table data from IndexedDB in a single transaction. */
export async function deletePeriod(periodNo: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['periods', 'tables'], 'readwrite');
  tx.objectStore('periods').delete(periodNo);
  // Delete all table entries whose key starts with `${periodNo}:`
  tx.objectStore('tables').delete(IDBKeyRange.bound(`${periodNo}:`, `${periodNo}:\uffff`));
  await tx.done;
}

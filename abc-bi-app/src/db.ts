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

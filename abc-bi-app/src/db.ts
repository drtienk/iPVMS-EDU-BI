import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { PeriodInfo } from './types';

// --- BI integrated data types (Session + dimensions + fact) ---

export interface UploadSession {
  sessionId: string;
  periodNo: number;
  uploadedAt: number;
  fileName: string;
  sheetStatus: Record<string, boolean>;
  rowCounts: Record<string, number>;
}

export interface DimCustomer {
  periodNo: number;
  customerId: string;
  customerName: string;
  company: string;
  buCode: string;
}

export interface DimProduct {
  periodNo: number;
  productCode: string;
  productName: string;
  company: string;
  buCode: string;
}

export interface FactCustomerProduct {
  periodNo: number;
  customerId: string;
  productCode: string;
  salesAmount: number;
  serviceCost: number;
  netProfit: number;
  quantity: number;
}

// --- Schema ---

export interface BIDB extends DBSchema {
  periods: {
    key: number;
    value: PeriodInfo;
  };
  tables: {
    key: string;
    value: unknown[];
  };
  upload_sessions: {
    key: string;
    value: UploadSession;
    indexes: { by_periodNo: number };
  };
  dim_customers: {
    key: string;
    value: DimCustomer;
  };
  dim_products: {
    key: string;
    value: DimProduct;
  };
  fact_customer_product: {
    key: string;
    value: FactCustomerProduct;
  };
}

const DB_NAME = 'abc-bi-db';
const DB_VERSION = 2;

export const dbPromise = openDB<BIDB>(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, newVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('periods', { keyPath: 'periodNo' });
      db.createObjectStore('tables');
    }
    if (oldVersion < 2) {
      const sessionStore = db.createObjectStore('upload_sessions', { keyPath: 'sessionId' });
      sessionStore.createIndex('by_periodNo', 'periodNo');
      db.createObjectStore('dim_customers');
      db.createObjectStore('dim_products');
      db.createObjectStore('fact_customer_product');
    }
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
  tx.objectStore('tables').delete(IDBKeyRange.bound(`${periodNo}:`, `${periodNo}:\uffff`));
  await tx.done;
}

// --- Session + dimensions + fact helpers ---

export async function saveUploadSession(session: UploadSession): Promise<void> {
  const db = await getDb();
  await db.put('upload_sessions', session);
}

export async function putDimCustomers(rows: DimCustomer[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('dim_customers', 'readwrite');
  const store = tx.objectStore('dim_customers');
  for (const row of rows) {
    const key = `${row.periodNo}:${row.customerId}`;
    await store.put(row, key);
  }
  await tx.done;
}

export async function putDimProducts(rows: DimProduct[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('dim_products', 'readwrite');
  const store = tx.objectStore('dim_products');
  for (const row of rows) {
    const key = `${row.periodNo}:${row.productCode}`;
    await store.put(row, key);
  }
  await tx.done;
}

export async function putFactCustomerProduct(rows: FactCustomerProduct[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('fact_customer_product', 'readwrite');
  const store = tx.objectStore('fact_customer_product');
  for (const row of rows) {
    const key = `${row.periodNo}:${row.customerId}:${row.productCode}`;
    await store.put(row, key);
  }
  await tx.done;
}

/** Delete all upload_sessions with the given periodNo. */
export async function deleteSessionByPeriod(periodNo: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('upload_sessions', 'readwrite');
  const store = tx.objectStore('upload_sessions');
  const sessionIds = await store.index('by_periodNo').getAllKeys(IDBKeyRange.only(periodNo));
  for (const id of sessionIds) {
    store.delete(id);
  }
  await tx.done;
}

import * as XLSX from 'xlsx';
import { listPeriods, getTable } from '../dataApi';
import { toNumber, extractId } from '../normalize';
import type { AnalysisPayload } from './pyodideRunner';
import type { ActivityDriverRow, IncomeStatmentRow } from '../types';

/** A per-activity column is included only if it appears in at least this many visits. */
const MIN_VISITS_PER_ACTIVITY = 8;

export interface VisitRecord {
  code: string;     // customer code, e.g. C447
  name: string;     // customer name
  month: number;    // 1..12
  day: number;      // day of month
  dept: string;     // Activity center code (SASL10/SASL20/...)
  owner: string;    // salesperson
  activity: string; // activity label "A22:項目追蹤"
}

export interface ParsedTimesheet {
  visits: VisitRecord[];
  depts: string[];        // distinct activity centers, sorted by visit count desc
  activities: string[];   // distinct activity labels worth testing
  months: number[];
}

export interface MarketData {
  revenue: Map<string, number>; // `${code}|${month}` -> amount
  cost: Map<string, number>;
  periods: number[];
}

function getCol(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return undefined;
}

function parseMonthDay(v: unknown): { month: number; day: number } | null {
  if (v instanceof Date) return { month: v.getMonth() + 1, day: v.getDate() };
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF ? new Date(Math.round((v - 25569) * 86400 * 1000)) : null;
    if (d && !isNaN(d.getTime())) return { month: d.getMonth() + 1, day: d.getDate() };
  }
  if (typeof v === 'string') {
    const m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { month: Number(m[2]), day: Number(m[3]) };
  }
  return null;
}

/** Parse the RAW timesheet (v3): sheet 拜訪紀錄 + customer / activity lookups. */
export async function parseTimesheetV3(file: File): Promise<ParsedTimesheet> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });

  // customer sheet: Customer code | 客戶名稱
  const name2code = new Map<string, string>();
  const custSheet = wb.Sheets['customer'] ?? wb.Sheets['Customer'];
  if (custSheet) {
    for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(custSheet, { defval: '' })) {
      const code = String(getCol(r, 'Customer code', 'Customer Code', 'Code') ?? '').trim();
      const name = String(getCol(r, '客戶名稱 (同步)', '客戶名稱', 'Name') ?? '').trim();
      if (code && name) name2code.set(name, code);
    }
  }

  const visitSheet = wb.Sheets['拜訪紀錄'] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(visitSheet, { defval: '' });
  const visits: VisitRecord[] = [];
  const deptCount = new Map<string, number>();
  const actCount = new Map<string, number>();
  for (const r of rows) {
    const start = getCol(r, '拜訪紀錄開始', '拜訪預計完成日', '物件建立日期/時間');
    const md = parseMonthDay(start);
    if (!md) continue;
    const name = String(getCol(r, '客戶名稱 (同步)', '客戶名稱') ?? '').trim();
    let code = String(getCol(r, 'Customer code', 'Customer Code') ?? '').trim();
    if (!code || code.startsWith('=') || !/^C?\d/i.test(code)) {
      code = name2code.get(name) ?? '';
    }
    if (!code) continue;
    const dept = String(getCol(r, 'Activity center code', 'Activity Center Code') ?? '').trim() || '(未分類)';
    const owner = String(getCol(r, '擁有者', 'Owner') ?? '').trim();
    const actCode = String(getCol(r, 'activity code', 'Activity Code') ?? '').trim();
    const purpose = String(getCol(r, '拜訪目的') ?? '').trim();
    const activity = actCode ? (purpose ? `${actCode}:${purpose}` : actCode) : (purpose || '(未填)');
    visits.push({ code, name, month: md.month, day: md.day, dept, owner, activity });
    deptCount.set(dept, (deptCount.get(dept) ?? 0) + 1);
    actCount.set(activity, (actCount.get(activity) ?? 0) + 1);
  }
  const depts = Array.from(deptCount.entries()).sort((a, b) => b[1] - a[1]).map(([d]) => d);
  const activities = Array.from(actCount.entries())
    .filter(([, n]) => n >= MIN_VISITS_PER_ACTIVITY)
    .sort((a, b) => b[1] - a[1])
    .map(([a]) => a);
  const months = Array.from(new Set(visits.map((v) => v.month))).sort((a, b) => a - b);
  return { visits, depts, activities, months };
}

/** Read revenue (IncomeStatment) + cost (ActivityDriver) per (code, month) from IndexedDB. */
export async function loadMarketData(): Promise<MarketData> {
  const periods = await listPeriods();
  const revenue = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const p of periods) {
    const month = p % 100;
    for (const r of await getTable<IncomeStatmentRow>(p, 'IncomeStatment')) {
      const code = String((r.customerId as string) ?? extractId(r.Customer as string) ?? '').trim();
      if (!code) continue;
      const m = toNumber(r.Month, month);
      revenue.set(`${code}|${m}`, (revenue.get(`${code}|${m}`) ?? 0) + toNumber(r.Amount, 0));
    }
    for (const r of await getTable<ActivityDriverRow>(p, 'ActivityDriver')) {
      const rr = r as unknown as Record<string, unknown>;
      const code = String((r.customerId as string) ?? extractId(rr['ValueObject'] as string) ?? '').trim();
      if (!code) continue;
      const m = toNumber(rr['Month'], month);
      cost.set(`${code}|${m}`, (cost.get(`${code}|${m}`) ?? 0) + toNumber(rr['ActCost'], 0));
    }
  }
  return { revenue, cost, periods };
}

/** Filter visits to a department scope (null = whole company). */
function scopeVisits(ts: ParsedTimesheet, dept: string | null): VisitRecord[] {
  return dept ? ts.visits.filter((v) => v.dept === dept) : ts.visits;
}

/** Build the regression payload for a given scope. */
export function buildPayload(
  ts: ParsedTimesheet,
  market: MarketData,
  dept: string | null,
  lags: number[]
): AnalysisPayload {
  const visits = scopeVisits(ts, dept);
  // per (code, month): visit count, distinct days, per-activity count
  interface CM { code: string; month: number; visits: number; days: Set<number>; perAct: Map<string, number> }
  const cm = new Map<string, CM>();
  for (const v of visits) {
    const key = `${v.code}|${v.month}`;
    let agg = cm.get(key);
    if (!agg) { agg = { code: v.code, month: v.month, visits: 0, days: new Set(), perAct: new Map() }; cm.set(key, agg); }
    agg.visits += 1;
    agg.days.add(v.day);
    if (ts.activities.includes(v.activity)) agg.perAct.set(v.activity, (agg.perAct.get(v.activity) ?? 0) + 1);
  }
  const columns = ['拜訪次數', '拜訪天數', '作業種類數', '投入成本', ...ts.activities];
  const cumulativeColumns = ['拜訪次數', '拜訪天數', '投入成本', ...ts.activities];
  const rows: (string | number)[][] = [];
  for (const a of cm.values()) {
    const base: (string | number)[] = [
      a.code, a.month, a.visits, a.days.size, a.perAct.size,
      market.cost.get(`${a.code}|${a.month}`) ?? 0,
    ];
    for (const act of ts.activities) base.push(a.perAct.get(act) ?? 0);
    rows.push(base);
  }
  const revRows: (string | number)[][] = [];
  for (const [key, amt] of market.revenue) {
    const [code, m] = key.split('|');
    revRows.push([code, Number(m), amt]);
  }
  return { features: { columns, rows }, revenue: revRows, lags, cumulativeColumns };
}

export interface BasicStats {
  refMonth: number;
  lag: number;
  totalVisits: number;
  visitDays: number;
  customersVisited: number;
  topCustomer: { code: string; name: string; visits: number } | null;
  topCustomerRevPrev: number;
  topCustomerRevNext: number;
  topCustomerIncreased: boolean | null; // null if next-month revenue unavailable
}

/** Compute headline basic statistics for a scope: latest month with available lag revenue. */
export function computeBasicStats(
  ts: ParsedTimesheet,
  market: MarketData,
  dept: string | null,
  lag: number
): BasicStats | null {
  const visits = scopeVisits(ts, dept);
  if (visits.length === 0) return null;
  const months = Array.from(new Set(visits.map((v) => v.month))).sort((a, b) => a - b);
  // prefer the latest month whose (month+lag) revenue exists somewhere; else the latest month
  const hasNext = (m: number) =>
    Array.from(market.revenue.keys()).some((k) => k.endsWith(`|${m + lag}`));
  const refMonth = [...months].reverse().find(hasNext) ?? months[months.length - 1];

  const monthVisits = visits.filter((v) => v.month === refMonth);
  const days = new Set(monthVisits.map((v) => v.day));
  const byCust = new Map<string, { name: string; n: number }>();
  for (const v of monthVisits) {
    const e = byCust.get(v.code) ?? { name: v.name, n: 0 };
    e.n += 1; byCust.set(v.code, e);
  }
  let top: { code: string; name: string; visits: number } | null = null;
  for (const [code, e] of byCust) {
    if (!top || e.n > top.visits) top = { code, name: e.name, visits: e.n };
  }
  let prev = 0, next = 0, inc: boolean | null = null;
  if (top) {
    prev = market.revenue.get(`${top.code}|${refMonth}`) ?? 0;
    const nextKey = `${top.code}|${refMonth + lag}`;
    if (market.revenue.has(nextKey)) { next = market.revenue.get(nextKey)!; inc = next > prev; }
  }
  return {
    refMonth, lag,
    totalVisits: monthVisits.length,
    visitDays: days.size,
    customersVisited: byCust.size,
    topCustomer: top,
    topCustomerRevPrev: prev,
    topCustomerRevNext: next,
    topCustomerIncreased: inc,
  };
}

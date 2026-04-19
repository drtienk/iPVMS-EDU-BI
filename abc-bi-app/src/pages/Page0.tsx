import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRefreshContext } from '../contexts/RefreshContext';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { SimpleChart, formatMonthMMYYYY } from '../components/SimpleChart';
import { GroupedBarRows } from '../components/GroupedBarRows';
import type { GroupedBarRow } from '../components/GroupedBarRows';
import { getTableData, listPeriods, getTable } from '../dataApi';
import { formatMoney, formatNumber1, formatPercent } from '../utils/format';
import { toNumber } from '../normalize';
import type {
  CustomerProductProfitRow,
  CustomerProfitResultRow,
  CustomerServiceCostRow,
  IncomeStatmentRow,
  ProductProfitResultRow,
} from '../types';
import type { ColumnDef } from '@tanstack/react-table';

const DRILLDOWN_BINS = 10;
const DEFAULT_TOP_N = 20;
const DRILLDOWN_TOP_PRODUCTS = 10;
const DRILLDOWN_TOP_SALES_ACTIVITY_CENTERS = 10;
const DRILLDOWN_TOP_CUSTOMERS = 10;
/** First-layer By Customer: show top N customers by (latest period) profit + Others */
const DRILLDOWN_TOP_CUSTOMERS_LAYER1 = 20;
/** Service Cost Breakdown chart: show top N activities by latest period cost */
const SERVICE_COST_CHART_TOP_N = 12;

type Drilldown2State = null | {
  salesActivityCenterKey: string;
  clickedPeriodNo: number;
  periods: number[];
};

/** Get 1–3 consecutive periods centered on clicked (prev, current, next). Works with 1, 2, or 3+ available periods. */
function getPeriodRange(periodNos: number[], clicked: number): number[] {
  const sorted = [...periodNos].sort((a, b) => a - b);
  if (sorted.length === 0) return [clicked];
  let idx = sorted.indexOf(clicked);
  if (idx === -1) {
    const nearest = sorted.reduce((a, b) =>
      Math.abs(a - clicked) <= Math.abs(b - clicked) ? a : b
    );
    idx = sorted.indexOf(nearest);
  }
  let start = idx - 1;
  let end = idx + 1;
  if (start < 0) {
    start = 0;
    end = Math.min(2, sorted.length - 1);
  }
  if (end >= sorted.length) {
    end = sorted.length - 1;
    start = Math.max(0, end - 2);
  }
  const result = sorted.slice(start, end + 1);
  return result.length > 0 ? result : [sorted[0] ?? clicked];
}

export interface DashboardAggregate {
  periodNo: number;
  totalProfitability: number;
  totalRevenue: number;
  totalServiceCost: number;
  customerCount: number;
}

async function computeDashboardAggregate(periodNo: number): Promise<DashboardAggregate | null> {
  try {
    const rows = await getTable<CustomerProfitResultRow>(periodNo, 'CustomerProfitResult');
    if (rows.length === 0) return null;

    const customerIds = new Set(rows.map((r) => String(r.customerId ?? '')).filter(Boolean));
    const totalProfitability = rows.reduce((s, r) => s + toNumber(r.CustomerProfit, 0), 0);
    const totalRevenueFromPrice = rows.reduce((s, r) => s + toNumber(r.Price, 0), 0);
    const totalServiceCost = rows.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0);

    let totalRevenue = totalRevenueFromPrice;
    if (totalRevenue === 0) {
      try {
        const incomeRows = await getTable<IncomeStatmentRow>(periodNo, 'IncomeStatment');
        totalRevenue = incomeRows.reduce((s, r) => s + toNumber(r.Amount, 0), 0);
      } catch {
        // keep 0
      }
    }

    return {
      periodNo,
      totalProfitability,
      totalRevenue,
      totalServiceCost,
      customerCount: customerIds.size,
    };
  } catch {
    return null;
  }
}

export interface HistBin {
  label: string;
  count: number;
  sumProfit: number;
}

function buildHistBins(rows: CustomerProfitResultRow[], numBins: number): HistBin[] {
  const profits = rows.map((r) => toNumber(r.CustomerProfit, 0));
  if (profits.length === 0) return [];
  const min = Math.min(...profits);
  const max = Math.max(...profits);
  const range = max - min || 1;
  const binWidth = range / numBins;
  const bins: HistBin[] = Array.from({ length: numBins }, (_, i) => {
    const lo = min + i * binWidth;
    const hi = i === numBins - 1 ? max : min + (i + 1) * binWidth;
    return { label: `${formatMoney(lo)} ~ ${formatMoney(hi)}`, count: 0, sumProfit: 0 };
  });
  for (const p of profits) {
    let idx = Math.min(Math.floor((p - min) / binWidth), numBins - 1);
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
    bins[idx].sumProfit += p;
  }
  return bins;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Build Product Service Cost breakdown by Employee/Activity Center from CustomerServiceCost.
 *  ServiceProduct format is "CODE:Name" (e.g. "TH001:Therapy") — match the name part after ":".
 *  Groups by Activity Center (e.g. "D120:Sharon" = employee), sums hours + cost per period. */
function buildProductServiceCostByEmployee(
  resultsByPeriod: CustomerServiceCostRow[][],
  selectedPeriods: number[],
  productName: string
): { rows: Record<string, string | number>[]; periodTotals: { periodNo: number; totalCost: number }[] } {
  const byPeriodCenter = new Map<number, Map<string, { hours: number; cost: number }>>();
  const allCenters = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, { hours: number; cost: number }>();
    for (const r of rows) {
      const sp = String(r.ServiceProduct ?? '').trim();
      // "TH001:Therapy" → extract "Therapy"; plain "Therapy" stays as-is
      const spName = sp.includes(':') ? sp.split(':').slice(1).join(':').trim() : sp;
      if (spName !== productName && sp !== productName) continue;
      const rr = r as unknown as Record<string, unknown>;
      const center = String(r.activityCenterKey || rr['Activity Center'] || rr[' Activity Center'] || '').trim() || '(Unknown)';
      const hours = toNumber(r.DriverValue, 0);
      const cost = toNumber(r.Amount, 0);
      const prev = map.get(center) ?? { hours: 0, cost: 0 };
      map.set(center, { hours: prev.hours + hours, cost: prev.cost + cost });
      allCenters.add(center);
    }
    byPeriodCenter.set(periodNo, map);
  });
  const rows: Record<string, string | number>[] = [];
  for (const center of Array.from(allCenters).sort()) {
    const row: Record<string, string | number> = { activity: center };
    for (const p of selectedPeriods) {
      const m = byPeriodCenter.get(p)?.get(center) ?? { hours: 0, cost: 0 };
      row[`${p}_hours`] = m.hours;
      row[`${p}_cost`] = m.cost;
    }
    rows.push(row);
  }
  const periodTotals = selectedPeriods.map((periodNo) => ({
    periodNo,
    totalCost: rows.reduce((s, row) => s + Number(row[`${periodNo}_cost`] ?? 0), 0),
  }));
  return { rows, periodTotals };
}

/** Build Activity breakdown for one Activity Center from CustomerServiceCost (level 4 drill). */
function buildProductServiceCostByActivity(
  resultsByPeriod: CustomerServiceCostRow[][],
  selectedPeriods: number[],
  productName: string,
  centerKey: string
): { rows: Record<string, string | number>[]; periodTotals: { periodNo: number; totalCost: number }[] } {
  const byPeriodActivity = new Map<number, Map<string, { hours: number; cost: number }>>();
  const allActivities = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, { hours: number; cost: number }>();
    for (const r of rows) {
      const sp = String(r.ServiceProduct ?? '').trim();
      const spName = sp.includes(':') ? sp.split(':').slice(1).join(':').trim() : sp;
      if (spName !== productName && sp !== productName) continue;
      const rr = r as unknown as Record<string, unknown>;
      const center = String(r.activityCenterKey || rr['Activity Center'] || rr[' Activity Center'] || '').trim();
      if (center !== centerKey) continue;
      const code = String(rr['Code'] ?? r.activityCodeKey ?? '').trim() || '(Unknown)';
      const hours = toNumber(r.DriverValue, 0);
      const cost = toNumber(r.Amount, 0);
      const prev = map.get(code) ?? { hours: 0, cost: 0 };
      map.set(code, { hours: prev.hours + hours, cost: prev.cost + cost });
      allActivities.add(code);
    }
    byPeriodActivity.set(periodNo, map);
  });
  const rows: Record<string, string | number>[] = [];
  for (const code of Array.from(allActivities).sort()) {
    const row: Record<string, string | number> = { activity: code };
    for (const p of selectedPeriods) {
      const m = byPeriodActivity.get(p)?.get(code) ?? { hours: 0, cost: 0 };
      row[`${p}_hours`] = m.hours;
      row[`${p}_cost`] = m.cost;
    }
    rows.push(row);
  }
  const periodTotals = selectedPeriods.map((periodNo) => ({
    periodNo,
    totalCost: rows.reduce((s, row) => s + Number(row[`${periodNo}_cost`] ?? 0), 0),
  }));
  return { rows, periodTotals };
}

/** Build Activity Center breakdown for one Activity Code from CustomerServiceCost (customer level 4 drill). */
function buildCustomerServiceCostByActivityCenter(
  resultsByPeriod: CustomerServiceCostRow[][],
  selectedPeriods: number[],
  customerId: string,
  activityCode: string
): { rows: Record<string, string | number>[]; periodTotals: { periodNo: number; totalCost: number }[] } {
  const byPeriodCenter = new Map<number, Map<string, { hours: number; cost: number }>>();
  const allCenters = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, { hours: number; cost: number }>();
    for (const r of rows) {
      const key = String(r.customerId ?? r.Customer ?? '').trim() || '(Unknown Customer)';
      if (key !== customerId) continue;
      const code = String(r.Code ?? '').trim() || '(Unknown)';
      if (code !== activityCode) continue;
      const rr = r as unknown as Record<string, unknown>;
      const center = String(r.activityCenterKey || rr['Activity Center'] || rr[' Activity Center'] || '').trim() || '(Unknown)';
      const hours = toNumber(r.DriverValue, 0);
      const cost = toNumber(r.Amount, 0);
      const prev = map.get(center) ?? { hours: 0, cost: 0 };
      map.set(center, { hours: prev.hours + hours, cost: prev.cost + cost });
      allCenters.add(center);
    }
    byPeriodCenter.set(periodNo, map);
  });
  const rows: Record<string, string | number>[] = [];
  for (const center of Array.from(allCenters).sort()) {
    const row: Record<string, string | number> = { activity: center };
    for (const p of selectedPeriods) {
      const m = byPeriodCenter.get(p)?.get(center) ?? { hours: 0, cost: 0 };
      row[`${p}_hours`] = m.hours;
      row[`${p}_cost`] = m.cost;
    }
    rows.push(row);
  }
  const periodTotals = selectedPeriods.map((periodNo) => ({
    periodNo,
    totalCost: rows.reduce((s, row) => s + Number(row[`${periodNo}_cost`] ?? 0), 0),
  }));
  return { rows, periodTotals };
}

/** Build Service Cost breakdown by Activity (Code) for a Sales Activity Center (level 3 SAC path). */
function buildSacServiceCostByActivity(
  resultsByPeriod: CustomerServiceCostRow[][],
  selectedPeriods: number[],
  sacKey: string
): { rows: Record<string, string | number>[]; periodTotals: { periodNo: number; totalCost: number }[] } {
  const byPeriodCode = new Map<number, Map<string, { hours: number; cost: number }>>();
  const allCodes = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, { hours: number; cost: number }>();
    for (const r of rows) {
      const rr = r as unknown as Record<string, unknown>;
      const center = String(r.activityCenterKey || rr['Activity Center'] || rr[' Activity Center'] || '').trim();
      if (center !== sacKey) continue;
      const code = String(rr['Code'] ?? r.activityCodeKey ?? '').trim() || '(Unknown)';
      const hours = toNumber(r.DriverValue, 0);
      const cost = toNumber(r.Amount, 0);
      const prev = map.get(code) ?? { hours: 0, cost: 0 };
      map.set(code, { hours: prev.hours + hours, cost: prev.cost + cost });
      allCodes.add(code);
    }
    byPeriodCode.set(periodNo, map);
  });
  const rows: Record<string, string | number>[] = [];
  for (const code of Array.from(allCodes).sort()) {
    const row: Record<string, string | number> = { activity: code };
    for (const p of selectedPeriods) {
      const m = byPeriodCode.get(p)?.get(code) ?? { hours: 0, cost: 0 };
      row[`${p}_hours`] = m.hours;
      row[`${p}_cost`] = m.cost;
    }
    rows.push(row);
  }
  const periodTotals = selectedPeriods.map((periodNo) => ({
    periodNo,
    totalCost: rows.reduce((s, row) => s + Number(row[`${periodNo}_cost`] ?? 0), 0),
  }));
  return { rows, periodTotals };
}

/** Build Service Cost breakdown by Activity (Code) from CustomerServiceCost. Group by Code, sum DriverValue (hours) and Amount (cost) per period. */
function buildServiceCostByActivity(
  resultsByPeriod: CustomerServiceCostRow[][],
  selectedPeriods: number[],
  customerId: string
): { rows: Record<string, string | number>[]; periodTotals: { periodNo: number; totalCost: number }[] } {
  const byPeriodCode = new Map<number, Map<string, { hours: number; cost: number }>>();
  const allCodes = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, { hours: number; cost: number }>();
    for (const r of rows) {
      const key = String(r.customerId ?? r.Customer ?? '').trim() || '(Unknown Customer)';
      if (key !== customerId) continue;
      const code = String(r.Code ?? '').trim() || '(Unknown)';
      const hours = toNumber(r.DriverValue, 0);
      const cost = toNumber(r.Amount, 0);
      const prev = map.get(code) ?? { hours: 0, cost: 0 };
      map.set(code, { hours: prev.hours + hours, cost: prev.cost + cost });
      allCodes.add(code);
    }
    byPeriodCode.set(periodNo, map);
  });
  const rows: Record<string, string | number>[] = [];
  for (const code of Array.from(allCodes).sort()) {
    const row: Record<string, string | number> = { activity: code };
    for (const p of selectedPeriods) {
      const m = byPeriodCode.get(p)?.get(code) ?? { hours: 0, cost: 0 };
      row[`${p}_hours`] = m.hours;
      row[`${p}_cost`] = m.cost;
    }
    rows.push(row);
  }
  const periodTotals = selectedPeriods.map((periodNo) => {
    const totalCost = rows.reduce(
      (s, row) => s + Number(row[`${periodNo}_cost`] ?? 0),
      0
    );
    return { periodNo, totalCost };
  });
  return { rows, periodTotals };
}

/**
 * Build customerId -> Customer Name map from CustomerProfitResult rows (same source as By Customer).
 * ID is used for grouping; name is for display only.
 */
function buildCustomerNameMap(rowsByPeriod: CustomerProfitResultRow[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rows of rowsByPeriod) {
    for (const r of rows) {
      const key = String(r.customerId ?? r.CustomerID ?? '').trim() || '(Unknown Customer)';
      const name = String(r.Customer ?? '').trim();
      if (name && !map.has(key)) map.set(key, name);
    }
  }
  return map;
}

/** Build first-layer By Customer grouped rows from CustomerProfitResult per period. Same source as Total Profitability. */
function buildDrilldownByCustomer(
  resultsByPeriod: CustomerProfitResultRow[][],
  selectedPeriods: number[],
  topN: number,
  sortAsc: boolean = false
): { rows: GroupedBarRow[]; monthTotals: { period: number; total: number }[] } {
  const customerNameMap = buildCustomerNameMap(resultsByPeriod);
  const byPeriod = new Map<number, Map<string, number>>();
  const allCustomerKeys = new Set<string>();
  resultsByPeriod.forEach((rows, i) => {
    const periodNo = selectedPeriods[i]!;
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.customerId ?? r.CustomerID ?? '').trim() || '(Unknown Customer)';
      const profit = toNumber(r.CustomerProfit, 0);
      map.set(key, (map.get(key) ?? 0) + profit);
      allCustomerKeys.add(key);
    }
    byPeriod.set(periodNo, map);
  });
  const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
  const customerTotals = Array.from(allCustomerKeys).map((key) => ({
    key,
    sum: selectedPeriods.reduce((s, p) => s + Math.abs(byPeriod.get(p)?.get(key) ?? 0), 0),
    lastPeriodProfit: byPeriod.get(lastPeriod ?? 0)?.get(key) ?? 0,
  }));
  customerTotals.sort((a, b) => sortAsc ? a.lastPeriodProfit - b.lastPeriodProfit : b.lastPeriodProfit - a.lastPeriodProfit);
  const topKeys = new Set(customerTotals.slice(0, topN).map((x) => x.key));
  const rows: GroupedBarRow[] = [];
  for (const { key } of customerTotals.slice(0, topN)) {
    const values = selectedPeriods.map((p) => ({
      x: p,
      y: byPeriod.get(p)?.get(key) ?? 0,
    }));
    const displayLabel = customerNameMap.get(key) ?? key ?? '(Unknown Customer)';
    rows.push({
      group: displayLabel,
      values,
      total: values.reduce((s, v) => s + v.y, 0),
      dataKey: key,
    });
  }
  const othersSum = customerTotals.slice(topN).reduce((s, x) => s + x.sum, 0);
  if (othersSum !== 0 || customerTotals.length > topN) {
    const othersValues = selectedPeriods.map((p) => ({
      x: p,
      y: Array.from(allCustomerKeys)
        .filter((k) => !topKeys.has(k))
        .reduce((s, k) => s + (byPeriod.get(p)?.get(k) ?? 0), 0),
    }));
    rows.push({
      group: 'Others',
      values: othersValues,
      total: othersValues.reduce((s, v) => s + v.y, 0),
    });
  }
  const monthTotals = selectedPeriods.map((period) => ({
    period,
    total: rows.reduce((s, row) => s + (row.values.find((v) => v.x === period)?.y ?? 0), 0),
  }));
  return { rows, monthTotals };
}

export function Page0() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshToken } = useRefreshContext();
  const periodNoStr = searchParams.get('periodNo');
  const periodNo = periodNoStr ? Number(periodNoStr) : NaN;
  const [data, setData] = useState<CustomerProfitResultRow[]>([]);
  const [aggregates, setAggregates] = useState<DashboardAggregate[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [selectedPeriodNo, setSelectedPeriodNo] = useState<number | null>(null);
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>([]);
  const [drilldownMode, setDrilldownMode] = useState<'whale' | 'ranked' | 'hist' | 'product' | 'salesActivityCenter' | 'customer' | 'compare'>('whale');
  const [compareType, setCompareType] = useState<'product' | 'sac' | 'customer'>('product');
  const [compareSelected, setCompareSelected] = useState<{ key: string; label: string }[]>([]);
  const [compareMetricsMap, setCompareMetricsMap] = useState<Record<string, { revenue: number; cogs: number; serviceCost: number; managementCost: number; profit: number }>>({});
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareServiceCostDrill, setCompareServiceCostDrill] = useState(false);
  const [compareServiceCostRows, setCompareServiceCostRows] = useState<GroupedBarRow[]>([]);
  const [compareServiceCostLoading, setCompareServiceCostLoading] = useState(false);
  const [customerSortMode, setCustomerSortMode] = useState<'top' | 'bottom'>('top');
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const [showAllRanked, setShowAllRanked] = useState(false);
  const [drilldownRows, setDrilldownRows] = useState<CustomerProfitResultRow[]>([]);
  const [histBins, setHistBins] = useState<HistBin[]>([]);
  const [_productRows, setProductRows] = useState<{ productName: string; profit: number }[]>([]);
  const [allProductsForCompare, setAllProductsForCompare] = useState<{ name: string; profit: number }[]>([]);
  const [allSacForCompare, setAllSacForCompare] = useState<{ name: string; profit: number }[]>([]);
  const [allCustomersForCompare, setAllCustomersForCompare] = useState<{ key: string; label: string; profit: number }[]>([]);
  const [productDataAvailable, setProductDataAvailable] = useState(false);
  const [groupedProductRows, setGroupedProductRows] = useState<GroupedBarRow[]>([]);
  const [groupedSalesActivityCenterRows, setGroupedSalesActivityCenterRows] = useState<GroupedBarRow[]>([]);
  const [salesActivityCenterMonthTotals, setSalesActivityCenterMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [salesActivityCenterDataAvailable, setSalesActivityCenterDataAvailable] = useState(false);
  const [groupedCustomerRows, setGroupedCustomerRows] = useState<GroupedBarRow[]>([]);
  const [customerMonthTotals, setCustomerMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [customerDrill, setCustomerDrill] = useState<{ customerId: string; customerName: string } | null>(null);
  const [customerDrillMetrics, setCustomerDrillMetrics] = useState<{ periodNo: number; revenue: number; cogs: number; serviceCost: number; managementCost: number }[]>([]);
  const [productDrill, setProductDrill] = useState<{ productName: string } | null>(null);
  const [productDrillMetrics, setProductDrillMetrics] = useState<{ periodNo: number; revenue: number; cogs: number; serviceCost: number; managementCost: number; productProfit: number }[]>([]);
  const [productDrillLoading, setProductDrillLoading] = useState(false);
  const [productServiceCostDrill, setProductServiceCostDrill] = useState<{ productName: string } | null>(null);
  const [productServiceCostDrillRows, setProductServiceCostDrillRows] = useState<Record<string, string | number>[]>([]);
  const [productServiceCostDrillPeriodTotals, setProductServiceCostDrillPeriodTotals] = useState<{ periodNo: number; totalCost: number }[]>([]);
  const [productServiceCostDrillLoading, setProductServiceCostDrillLoading] = useState(false);
  const [productServiceCostCenterDrill, setProductServiceCostCenterDrill] = useState<{ productName: string; centerKey: string } | null>(null);
  const [productServiceCostCenterDrillRows, setProductServiceCostCenterDrillRows] = useState<Record<string, string | number>[]>([]);
  const [productServiceCostCenterDrillPeriodTotals, setProductServiceCostCenterDrillPeriodTotals] = useState<{ periodNo: number; totalCost: number }[]>([]);
  const [productServiceCostCenterDrillLoading, setProductServiceCostCenterDrillLoading] = useState(false);
  const [customerDrillLoading, setCustomerDrillLoading] = useState(false);
  const [serviceCostDrill, setServiceCostDrill] = useState<{ customerId: string; customerName: string } | null>(null);
  const [serviceCostDrillRows, setServiceCostDrillRows] = useState<Record<string, string | number>[]>([]);
  const [serviceCostDrillPeriodTotals, setServiceCostDrillPeriodTotals] = useState<{ periodNo: number; totalCost: number }[]>([]);
  const [serviceCostDrillLoading, setServiceCostDrillLoading] = useState(false);
  const [drilldown2, setDrilldown2] = useState<Drilldown2State>(null);
  const [drilldown2Mode, setDrilldown2Mode] = useState<'product' | 'customer'>('product');
  const [drilldown2ProductRows, setDrilldown2ProductRows] = useState<GroupedBarRow[]>([]);
  const [drilldown2CustomerRows, setDrilldown2CustomerRows] = useState<GroupedBarRow[]>([]);
  const [drilldown2ProductMonthTotals, setDrilldown2ProductMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [drilldown2CustomerMonthTotals, setDrilldown2CustomerMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [drilldown2Total, setDrilldown2Total] = useState<number | null>(null);
  const [drilldown2Loading, setDrilldown2Loading] = useState(false);
  const [drilldown2Message, setDrilldown2Message] = useState<string | null>(null);
  const [sacDrillMetrics, setSacDrillMetrics] = useState<{ periodNo: number; revenue: number; cogs: number; serviceCost: number; managementCost: number; profitability: number }[]>([]);
  const [sacDrillMetricsLoading, setSacDrillMetricsLoading] = useState(false);
  const [sacServiceCostDrill, setSacServiceCostDrill] = useState<{ sacKey: string } | null>(null);
  const [sacServiceCostDrillRows, setSacServiceCostDrillRows] = useState<Record<string, string | number>[]>([]);
  const [sacServiceCostDrillPeriodTotals, setSacServiceCostDrillPeriodTotals] = useState<{ periodNo: number; totalCost: number }[]>([]);
  const [sacServiceCostDrillLoading, setSacServiceCostDrillLoading] = useState(false);
  const [customerActivityCenterDrill, setCustomerActivityCenterDrill] = useState<{ customerId: string; activityCode: string } | null>(null);
  const [customerActivityCenterDrillRows, setCustomerActivityCenterDrillRows] = useState<Record<string, string | number>[]>([]);
  const [customerActivityCenterDrillPeriodTotals, setCustomerActivityCenterDrillPeriodTotals] = useState<{ periodNo: number; totalCost: number }[]>([]);
  const [customerActivityCenterDrillLoading, setCustomerActivityCenterDrillLoading] = useState(false);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [errorDrilldown, setErrorDrilldown] = useState<string | null>(null);


  const railRef = useRef<HTMLDivElement>(null);
  const level2Ref = useRef<HTMLDivElement>(null);
  const level3Ref = useRef<HTMLDivElement>(null);
  const level4Ref = useRef<HTMLDivElement>(null);
  const activeLevel = (productServiceCostCenterDrill != null || customerActivityCenterDrill != null) ? 4 : (serviceCostDrill != null || productServiceCostDrill != null || sacServiceCostDrill != null) ? 3 : (customerDrill != null || drilldown2 != null || productDrill != null || compareServiceCostDrill) ? 2 : 1;

  useEffect(() => {
    if (customerDrill != null || drilldown2 != null) {
      requestAnimationFrame(() => {
        level2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [customerDrill, drilldown2]);

  useEffect(() => {
    if (serviceCostDrill != null) {
      requestAnimationFrame(() => {
        level3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [serviceCostDrill]);

  useEffect(() => {
    if (productServiceCostCenterDrill != null) {
      requestAnimationFrame(() => {
        level4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [productServiceCostCenterDrill]);

  useEffect(() => {
    if (compareServiceCostDrill) {
      requestAnimationFrame(() => { level2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }
  }, [compareServiceCostDrill]);

  useEffect(() => {
    if (isNaN(periodNo)) {
      setData([]);
      return;
    }
    getTableData<CustomerProfitResultRow>(periodNo, 'CustomerProfitResult').then(setData);
  }, [periodNo, refreshToken]);

  useEffect(() => {
    setDashboardLoading(true);
    setDashboardError(null);
    listPeriods()
      .then(async (periodNos) => {
        const result: DashboardAggregate[] = [];
        for (const no of periodNos) {
          const agg = await computeDashboardAggregate(no);
          if (agg != null) result.push(agg);
        }
        setAggregates(result);
      })
      .catch(() => setDashboardError('No data'))
      .finally(() => setDashboardLoading(false));
  }, [refreshToken]);

  useEffect(() => {
    if (selectedPeriodNo == null) {
      setDrilldownRows([]);
      setHistBins([]);
      setProductRows([]);
      setProductDataAvailable(false);
      setGroupedSalesActivityCenterRows([]);
      setSalesActivityCenterMonthTotals([]);
      setSalesActivityCenterDataAvailable(false);
      setGroupedCustomerRows([]);
      setCustomerMonthTotals([]);
      setCustomerDrill(null);
      setCustomerDrillMetrics([]);
      setServiceCostDrill(null);
      setCustomerActivityCenterDrill(null);
      setServiceCostDrillRows([]);
      setServiceCostDrillPeriodTotals([]);
      setDrilldown2(null);
      setDrilldown2Mode('product');
      setDrilldown2ProductRows([]);
      setDrilldown2CustomerRows([]);
      setDrilldown2ProductMonthTotals([]);
      setDrilldown2CustomerMonthTotals([]);
      setDrilldown2Total(null);
      setDrilldown2Message(null);
      setErrorDrilldown(null);
      return;
    }
    let cancelled = false;
    setLoadingDrilldown(true);
    setErrorDrilldown(null);
    getTable<CustomerProfitResultRow>(selectedPeriodNo, 'CustomerProfitResult')
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort(
          (a, b) => toNumber(b.CustomerProfit, 0) - toNumber(a.CustomerProfit, 0)
        );
        setDrilldownRows(sorted);
        setHistBins(buildHistBins(rows, DRILLDOWN_BINS));
      })
      .catch(() => {
        if (!cancelled) setErrorDrilldown('No data for this period');
      })
      .finally(() => {
        if (!cancelled) setLoadingDrilldown(false);
      });
    getTable<ProductProfitResultRow>(selectedPeriodNo, 'ProductProfitResult')
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        const byProduct = new Map<string, number>();
        for (const r of rows) {
          const name = String(r.Product ?? r.ProductID ?? '').trim() || '(Unknown)';
          const profit = toNumber(r.ProductProfit, 0);
          byProduct.set(name, (byProduct.get(name) ?? 0) + profit);
        }
        const list = Array.from(byProduct.entries())
          .map(([productName, profit]) => ({ productName, profit }))
          .sort((a, b) => b.profit - a.profit);
        setProductRows(list);
        setProductDataAvailable(list.length > 0);
      })
      .catch(() => {});
    getTable<CustomerProductProfitRow>(selectedPeriodNo, 'CustomerProductProfit')
      .then((rows) => {
        if (cancelled) return;
        const hasSalesActivityCenter = rows.some(
          (r) => String(r.SalesActivityCenter ?? '').trim() !== ''
        );
        setSalesActivityCenterDataAvailable(hasSalesActivityCenter && rows.length > 0);
      })
      .catch(() => {
        if (!cancelled) setSalesActivityCenterDataAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodNo]);

  useEffect(() => {
    if (selectedPeriods.length === 0) {
      setGroupedProductRows([]);
      setAllProductsForCompare([]);
      return;
    }
    let cancelled = false;
    Promise.all(selectedPeriods.map((p) => getTable<ProductProfitResultRow>(p, 'ProductProfitResult')))
      .then((results) => {
        if (cancelled) return;
        const byPeriod = new Map<number, Map<string, number>>();
        const allProducts = new Set<string>();
        results.forEach((rows, i) => {
          const periodNo = selectedPeriods[i]!;
          const map = new Map<string, number>();
          for (const r of rows) {
            const name = String(r.Product ?? r.ProductID ?? '').trim() || '(Unknown)';
            const profit = toNumber(r.ProductProfit, 0);
            map.set(name, (map.get(name) ?? 0) + profit);
            allProducts.add(name);
          }
          byPeriod.set(periodNo, map);
        });
        const productTotals = Array.from(allProducts).map((name) => {
          const sum = selectedPeriods.reduce(
            (s, p) => s + Math.abs(byPeriod.get(p)?.get(name) ?? 0),
            0
          );
          return { name, sum };
        });
        productTotals.sort((a, b) => b.sum - a.sum);
        const topNames = new Set(productTotals.slice(0, DRILLDOWN_TOP_PRODUCTS).map((x) => x.name));
        const rows: GroupedBarRow[] = [];
        for (const { name } of productTotals.slice(0, DRILLDOWN_TOP_PRODUCTS)) {
          rows.push({
            group: name,
            values: selectedPeriods.map((p) => ({
              x: p,
              y: byPeriod.get(p)?.get(name) ?? 0,
            })),
          });
        }
        const othersSum = productTotals.slice(DRILLDOWN_TOP_PRODUCTS).reduce((s, x) => s + x.sum, 0);
        if (othersSum > 0 || productTotals.length > DRILLDOWN_TOP_PRODUCTS) {
          rows.push({
            group: 'Others',
            values: selectedPeriods.map((p) => ({
              x: p,
              y: Array.from(allProducts)
                .filter((n) => !topNames.has(n))
                .reduce((s, n) => s + (byPeriod.get(p)?.get(n) ?? 0), 0),
            })),
          });
        }
        setGroupedProductRows(rows);
        const allForCompare = Array.from(allProducts).map((name) => ({
          name,
          profit: selectedPeriods.reduce((s, p) => s + (byPeriod.get(p)?.get(name) ?? 0), 0),
        })).sort((a, b) => b.profit - a.profit);
        setAllProductsForCompare(allForCompare);
      })
      .catch(() => {
        if (!cancelled) { setGroupedProductRows([]); setAllProductsForCompare([]); }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriods]);

  useEffect(() => {
    if (selectedPeriods.length === 0) {
      setGroupedSalesActivityCenterRows([]);
      setAllSacForCompare([]);
      return;
    }
    let cancelled = false;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerProductProfitRow>(p, 'CustomerProductProfit')))
      .then((results) => {
        if (cancelled) return;
        const byPeriod = new Map<number, Map<string, number>>();
        const allCenters = new Set<string>();
        results.forEach((rows, i) => {
          const periodNo = selectedPeriods[i]!;
          const map = new Map<string, number>();
          for (const r of rows) {
            const name = String(r.SalesActivityCenter ?? '').trim() || '(Unknown)';
            const profit = toNumber(r.NetIncome, 0);
            map.set(name, (map.get(name) ?? 0) + profit);
            allCenters.add(name);
          }
          byPeriod.set(periodNo, map);
        });
        const centerTotals = Array.from(allCenters).map((name) => {
          const sum = selectedPeriods.reduce(
            (s, p) => s + Math.abs(byPeriod.get(p)?.get(name) ?? 0),
            0
          );
          return { name, sum };
        });
        centerTotals.sort((a, b) => b.sum - a.sum);
        const topNames = new Set(centerTotals.slice(0, DRILLDOWN_TOP_SALES_ACTIVITY_CENTERS).map((x) => x.name));
        const rows: GroupedBarRow[] = [];
        for (const { name } of centerTotals.slice(0, DRILLDOWN_TOP_SALES_ACTIVITY_CENTERS)) {
          const values = selectedPeriods.map((p) => ({
            x: p,
            y: byPeriod.get(p)?.get(name) ?? 0,
          }));
          const total = values.reduce((s, v) => s + v.y, 0);
          rows.push({
            group: name,
            values,
            total,
          });
        }
        const othersSum = centerTotals.slice(DRILLDOWN_TOP_SALES_ACTIVITY_CENTERS).reduce((s, x) => s + x.sum, 0);
        if (othersSum > 0 || centerTotals.length > DRILLDOWN_TOP_SALES_ACTIVITY_CENTERS) {
          const othersValues = selectedPeriods.map((p) => ({
            x: p,
            y: Array.from(allCenters)
              .filter((n) => !topNames.has(n))
              .reduce((s, n) => s + (byPeriod.get(p)?.get(n) ?? 0), 0),
          }));
          const othersTotal = othersValues.reduce((s, v) => s + v.y, 0);
          rows.push({
            group: 'Others',
            values: othersValues,
            total: othersTotal,
          });
        }
        const monthTotals = selectedPeriods.map((period) => ({
          period,
          total: rows.reduce(
            (s, row) => s + (row.values.find((v) => v.x === period)?.y ?? 0),
            0
          ),
        }));
        setGroupedSalesActivityCenterRows(rows);
        setSalesActivityCenterMonthTotals(monthTotals);
        const allSac = Array.from(allCenters).map((name) => ({
          name,
          profit: selectedPeriods.reduce((s, p) => s + (byPeriod.get(p)?.get(name) ?? 0), 0),
        })).sort((a, b) => b.profit - a.profit);
        setAllSacForCompare(allSac);
      })
      .catch(() => {
        if (!cancelled) {
          setGroupedSalesActivityCenterRows([]);
          setSalesActivityCenterMonthTotals([]);
          setAllSacForCompare([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriods]);

  useEffect(() => {
    if (selectedPeriods.length === 0) {
      setGroupedCustomerRows([]);
      setCustomerMonthTotals([]);
      setAllCustomersForCompare([]);
      return;
    }
    let cancelled = false;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerProfitResultRow>(p, 'CustomerProfitResult')))
      .then((results) => {
        if (cancelled) return;
        const { rows, monthTotals } = buildDrilldownByCustomer(
          results,
          selectedPeriods,
          DRILLDOWN_TOP_CUSTOMERS_LAYER1,
          customerSortMode === 'bottom'
        );
        setGroupedCustomerRows(rows);
        setCustomerMonthTotals(monthTotals);
        const nameMap = buildCustomerNameMap(results);
        const profitMap = new Map<string, number>();
        for (const periodRows of results) {
          for (const r of periodRows) {
            const key = String(r.customerId ?? r.CustomerID ?? '').trim() || '(Unknown Customer)';
            profitMap.set(key, (profitMap.get(key) ?? 0) + toNumber(r.CustomerProfit, 0));
          }
        }
        const allCust = Array.from(profitMap.entries()).map(([key, profit]) => ({
          key,
          label: nameMap.get(key) ?? key,
          profit,
        })).sort((a, b) => b.profit - a.profit);
        setAllCustomersForCompare(allCust);
      })
      .catch(() => {
        if (!cancelled) {
          setGroupedCustomerRows([]);
          setCustomerMonthTotals([]);
          setAllCustomersForCompare([]);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [selectedPeriods, customerSortMode]);

  useEffect(() => {
    if (drilldownMode !== 'customer' || customerMonthTotals.length === 0 || aggregates.length === 0) return;
    customerMonthTotals.forEach(({ period, total }) => {
      const expected = aggregates.find((a) => a.periodNo === period)?.totalProfitability ?? 0;
      if (Math.abs(total - expected) > 1e-6) {
        console.warn('[Drill-down By Customer] period total !== Total Profitability', { period, total, expected });
      }
    });
  }, [drilldownMode, customerMonthTotals, aggregates]);

  useEffect(() => {
    if (customerDrill == null || selectedPeriods.length === 0) {
      setCustomerDrillMetrics([]);
      return;
    }
    let cancelled = false;
    setCustomerDrillLoading(true);
    const customerId = customerDrill.customerId;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerProfitResultRow>(p, 'CustomerProfitResult')))
      .then((results) => {
        if (cancelled) return;
        const metrics = results.map((rows, i) => {
          const periodNo = selectedPeriods[i]!;
          const matching = rows.filter(
            (r) => (String(r.customerId ?? r.CustomerID ?? '').trim() || '(Unknown Customer)') === customerId
          );
          const revenue = matching.reduce((s, r) => s + toNumber(r.Price, 0), 0);
          const cogs = matching.reduce((s, r) => s + toNumber(r.ManufactureCost, 0), 0);
          const serviceCost = matching.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0);
          const managementCost = matching.reduce((s, r) => s + toNumber(r.ManagementCost, 0), 0);
          return { periodNo, revenue, cogs, serviceCost, managementCost };
        });
        setCustomerDrillMetrics(metrics);
      })
      .catch(() => {
        if (!cancelled) setCustomerDrillMetrics([]);
      })
      .finally(() => {
        if (!cancelled) setCustomerDrillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerDrill, selectedPeriods]);

  useEffect(() => {
    if (serviceCostDrill == null || selectedPeriods.length === 0) {
      setServiceCostDrillRows([]);
      setServiceCostDrillPeriodTotals([]);
      return;
    }
    let cancelled = false;
    setServiceCostDrillLoading(true);
    const customerId = serviceCostDrill.customerId;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')))
      .then((results) => {
        if (cancelled) return;
        const { rows, periodTotals } = buildServiceCostByActivity(results, selectedPeriods, customerId);
        setServiceCostDrillRows(rows);
        setServiceCostDrillPeriodTotals(periodTotals);
      })
      .catch(() => {
        if (!cancelled) {
          setServiceCostDrillRows([]);
          setServiceCostDrillPeriodTotals([]);
        }
      })
      .finally(() => {
        if (!cancelled) setServiceCostDrillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceCostDrill, selectedPeriods]);

  useEffect(() => {
    if (serviceCostDrill == null || customerDrill == null || serviceCostDrill.customerId !== customerDrill.customerId) return;
    if (serviceCostDrillPeriodTotals.length === 0 || customerDrillMetrics.length === 0) return;
    serviceCostDrillPeriodTotals.forEach(({ periodNo, totalCost }) => {
      const expected = customerDrillMetrics.find((m) => m.periodNo === periodNo)?.serviceCost ?? 0;
      if (Math.abs(totalCost - expected) > 1e-6) {
        console.warn('[Service Cost Drill] period total cost !== CustomerProfitResult.ServiceCost', { periodNo, totalCost, expected });
      }
    });
  }, [serviceCostDrill, customerDrill, serviceCostDrillPeriodTotals, customerDrillMetrics]);

  useEffect(() => {
    if (customerActivityCenterDrill == null || selectedPeriods.length === 0) {
      setCustomerActivityCenterDrillRows([]);
      setCustomerActivityCenterDrillPeriodTotals([]);
      return;
    }
    let cancelled = false;
    setCustomerActivityCenterDrillLoading(true);
    const { customerId, activityCode } = customerActivityCenterDrill;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')))
      .then((results) => {
        if (cancelled) return;
        const { rows, periodTotals } = buildCustomerServiceCostByActivityCenter(results, selectedPeriods, customerId, activityCode);
        setCustomerActivityCenterDrillRows(rows);
        setCustomerActivityCenterDrillPeriodTotals(periodTotals);
      })
      .catch(() => {
        if (!cancelled) { setCustomerActivityCenterDrillRows([]); setCustomerActivityCenterDrillPeriodTotals([]); }
      })
      .finally(() => { if (!cancelled) setCustomerActivityCenterDrillLoading(false); });
    return () => { cancelled = true; };
  }, [customerActivityCenterDrill, selectedPeriods]);

  useEffect(() => {
    if (productDrill == null || selectedPeriods.length === 0) {
      setProductDrillMetrics([]);
      return;
    }
    let cancelled = false;
    setProductDrillLoading(true);
    const name = productDrill.productName;
    Promise.all(selectedPeriods.map((p) => getTable<ProductProfitResultRow>(p, 'ProductProfitResult')))
      .then((tables) => {
        if (cancelled) return;
        const metrics = tables.map((rows, i) => {
          const periodNo = selectedPeriods[i]!;
          const matched = rows.filter((r) => (String(r.Product ?? r.ProductID ?? '').trim() || '(Unknown)') === name);
          return {
            periodNo,
            revenue: matched.reduce((s, r) => s + toNumber(r.Price, 0), 0),
            cogs: matched.reduce((s, r) => s + toNumber(r.ManufactureCost, 0), 0),
            serviceCost: matched.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0),
            managementCost: matched.reduce((s, r) => s + toNumber(r.ManagementCost, 0), 0),
            productProfit: matched.reduce((s, r) => s + toNumber(r.ProductProfit, 0), 0),
          };
        });
        setProductDrillMetrics(metrics);
      })
      .catch(() => { if (!cancelled) setProductDrillMetrics([]); })
      .finally(() => { if (!cancelled) setProductDrillLoading(false); });
    return () => { cancelled = true; };
  }, [productDrill, selectedPeriods]);

  useEffect(() => {
    if (productServiceCostDrill == null || selectedPeriods.length === 0) {
      setProductServiceCostDrillRows([]);
      setProductServiceCostDrillPeriodTotals([]);
      return;
    }
    let cancelled = false;
    setProductServiceCostDrillLoading(true);
    const pName = productServiceCostDrill.productName;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')))
      .then((results) => {
        if (cancelled) return;
        const { rows, periodTotals } = buildProductServiceCostByEmployee(results, selectedPeriods, pName);
        setProductServiceCostDrillRows(rows);
        setProductServiceCostDrillPeriodTotals(periodTotals);
      })
      .catch(() => {
        if (!cancelled) { setProductServiceCostDrillRows([]); setProductServiceCostDrillPeriodTotals([]); }
      })
      .finally(() => { if (!cancelled) setProductServiceCostDrillLoading(false); });
    return () => { cancelled = true; };
  }, [productServiceCostDrill, selectedPeriods]);

  useEffect(() => {
    if (productServiceCostCenterDrill == null || selectedPeriods.length === 0) {
      setProductServiceCostCenterDrillRows([]);
      setProductServiceCostCenterDrillPeriodTotals([]);
      return;
    }
    let cancelled = false;
    setProductServiceCostCenterDrillLoading(true);
    const { productName: pName, centerKey: cKey } = productServiceCostCenterDrill;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')))
      .then((results) => {
        if (cancelled) return;
        const { rows, periodTotals } = buildProductServiceCostByActivity(results, selectedPeriods, pName, cKey);
        setProductServiceCostCenterDrillRows(rows);
        setProductServiceCostCenterDrillPeriodTotals(periodTotals);
      })
      .catch(() => {
        if (!cancelled) { setProductServiceCostCenterDrillRows([]); setProductServiceCostCenterDrillPeriodTotals([]); }
      })
      .finally(() => { if (!cancelled) setProductServiceCostCenterDrillLoading(false); });
    return () => { cancelled = true; };
  }, [productServiceCostCenterDrill, selectedPeriods]);

  useEffect(() => {
    if (sacServiceCostDrill == null || selectedPeriods.length === 0) {
      setSacServiceCostDrillRows([]);
      setSacServiceCostDrillPeriodTotals([]);
      return;
    }
    let cancelled = false;
    setSacServiceCostDrillLoading(true);
    const { sacKey } = sacServiceCostDrill;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')))
      .then((results) => {
        if (cancelled) return;
        const { rows, periodTotals } = buildSacServiceCostByActivity(results, selectedPeriods, sacKey);
        setSacServiceCostDrillRows(rows);
        setSacServiceCostDrillPeriodTotals(periodTotals);
      })
      .catch(() => { if (!cancelled) { setSacServiceCostDrillRows([]); setSacServiceCostDrillPeriodTotals([]); } })
      .finally(() => { if (!cancelled) setSacServiceCostDrillLoading(false); });
    return () => { cancelled = true; };
  }, [sacServiceCostDrill, selectedPeriods]);

  useEffect(() => {
    if (drilldownMode !== 'compare' || compareSelected.length === 0 || selectedPeriods.length === 0) {
      setCompareMetricsMap({});
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    const loadItem = async (item: { key: string; label: string }) => {
      if (compareType === 'product') {
        const tables = await Promise.all(selectedPeriods.map((p) => getTable<ProductProfitResultRow>(p, 'ProductProfitResult')));
        const matched = tables.flatMap((rows) => rows.filter((r) => String(r.Product ?? r.ProductID ?? '').trim() === item.label));
        return {
          revenue: matched.reduce((s, r) => s + toNumber(r.Price, 0), 0),
          cogs: matched.reduce((s, r) => s + toNumber(r.ManufactureCost, 0), 0),
          serviceCost: matched.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0),
          managementCost: matched.reduce((s, r) => s + toNumber(r.ManagementCost, 0), 0),
          profit: matched.reduce((s, r) => s + toNumber(r.ProductProfit, 0), 0),
        };
      } else {
        const tables = await Promise.all(selectedPeriods.map((p) => getTable<CustomerProductProfitRow>(p, 'CustomerProductProfit')));
        const matched = tables.flatMap((rows) => rows.filter((r) => {
          if (compareType === 'sac') return String(r.SalesActivityCenter ?? '').trim() === item.key;
          return String(r.Customer ?? '').trim() === item.label || String((r as unknown as Record<string,unknown>)['customerId'] ?? '').trim() === item.key;
        }));
        return {
          revenue: matched.reduce((s, r) => s + toNumber(r.Price, 0), 0),
          cogs: matched.reduce((s, r) => s + toNumber(r.ProductCost, 0), 0),
          serviceCost: matched.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0),
          managementCost: matched.reduce((s, r) => s + toNumber(r.ManagementCost, 0), 0),
          profit: matched.reduce((s, r) => s + toNumber(r.NetIncome, 0), 0),
        };
      }
    };
    Promise.all(compareSelected.map((item) => loadItem(item).then((metrics) => [item.key, metrics] as const)))
      .then((results) => { if (!cancelled) setCompareMetricsMap(Object.fromEntries(results)); })
      .catch(() => { if (!cancelled) setCompareMetricsMap({}); })
      .finally(() => { if (!cancelled) setCompareLoading(false); });
    return () => { cancelled = true; };
  }, [compareSelected, compareType, selectedPeriods, drilldownMode]);

  useEffect(() => {
    if (!compareServiceCostDrill || compareSelected.length === 0 || selectedPeriods.length === 0) {
      setCompareServiceCostRows([]);
      return;
    }
    let cancelled = false;
    setCompareServiceCostLoading(true);
    const getItemCost = async (item: { key: string; label: string }): Promise<Map<string, number>> => {
      const tables = await Promise.all(selectedPeriods.map((p) => getTable<CustomerServiceCostRow>(p, 'CustomerServiceCost')));
      const codeMap = new Map<string, number>();
      tables.forEach((rows) => {
        for (const r of rows) {
          const rr = r as unknown as Record<string, unknown>;
          let matches = false;
          if (compareType === 'product') {
            const sp = String(r.ServiceProduct ?? '').trim();
            const spName = sp.includes(':') ? sp.split(':').slice(1).join(':').trim() : sp;
            matches = spName === item.label || sp === item.label;
          } else if (compareType === 'sac') {
            const center = String(r.activityCenterKey || rr['Activity Center'] || rr[' Activity Center'] || '').trim();
            matches = center === item.key;
          } else {
            matches = String(r.customerId ?? '').trim() === item.key || String(rr['Customer'] ?? '').trim() === item.label;
          }
          if (!matches) continue;
          const code = String(rr['Code'] ?? r.activityCodeKey ?? '').trim() || '(Unknown)';
          codeMap.set(code, (codeMap.get(code) ?? 0) + toNumber(r.Amount, 0));
        }
      });
      return codeMap;
    };
    Promise.all(compareSelected.map((item) => getItemCost(item)))
      .then((maps) => {
        if (cancelled) return;
        const allCodes = new Set<string>();
        maps.forEach((m) => m.forEach((_, k) => allCodes.add(k)));
        const rows: GroupedBarRow[] = Array.from(allCodes).sort().map((code) => ({
          group: code,
          values: compareSelected.map((_, idx) => ({ x: idx, y: maps[idx]?.get(code) ?? 0 })),
          total: maps.reduce((s, m) => s + (m.get(code) ?? 0), 0),
        }));
        rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
        setCompareServiceCostRows(rows);
      })
      .catch(() => { if (!cancelled) setCompareServiceCostRows([]); })
      .finally(() => { if (!cancelled) setCompareServiceCostLoading(false); });
    return () => { cancelled = true; };
  }, [compareServiceCostDrill, compareSelected, compareType, selectedPeriods]);


  useEffect(() => {
    if (drilldown2 == null || drilldown2.periods.length === 0) {
      setSacDrillMetrics([]);
      return;
    }
    let cancelled = false;
    setSacDrillMetricsLoading(true);
    const centerKey = drilldown2.salesActivityCenterKey;
    Promise.all(drilldown2.periods.map((p) => getTable<CustomerProductProfitRow>(p, 'CustomerProductProfit')))
      .then((tables) => {
        if (cancelled) return;
        const metrics = tables.map((rows, i) => {
          const periodNo = drilldown2.periods[i]!;
          const matched = rows.filter((r) => String(r.SalesActivityCenter ?? '').trim() === centerKey);
          return {
            periodNo,
            revenue: matched.reduce((s, r) => s + toNumber(r.Price, 0), 0),
            cogs: matched.reduce((s, r) => s + toNumber(r.ProductCost, 0), 0),
            serviceCost: matched.reduce((s, r) => s + toNumber(r.ServiceCost, 0), 0),
            managementCost: matched.reduce((s, r) => s + toNumber(r.ManagementCost, 0), 0),
            profitability: matched.reduce((s, r) => s + toNumber(r.NetIncome, 0), 0),
          };
        });
        setSacDrillMetrics(metrics);
      })
      .catch(() => { if (!cancelled) setSacDrillMetrics([]); })
      .finally(() => { if (!cancelled) setSacDrillMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [drilldown2]);

  useEffect(() => {
    if (drilldown2 == null || drilldown2.periods.length === 0) {
      setDrilldown2ProductRows([]);
      setDrilldown2CustomerRows([]);
      setDrilldown2ProductMonthTotals([]);
      setDrilldown2CustomerMonthTotals([]);
      setDrilldown2Total(null);
      setDrilldown2Message(null);
      return;
    }
    let cancelled = false;
    setDrilldown2Loading(true);
    setDrilldown2Message(null);
    const centerKey = drilldown2.salesActivityCenterKey;
    Promise.all(drilldown2.periods.map((p) => getTable<CustomerProductProfitRow>(p, 'CustomerProductProfit')))
      .then((results) => {
        if (cancelled) return;
        const byPeriodProduct = new Map<number, Map<string, number>>();
        const byPeriodCustomer = new Map<number, Map<string, number>>();
        const allProducts = new Set<string>();
        const allCustomers = new Set<string>();
        results.forEach((rows, i) => {
          const periodNo = drilldown2.periods[i]!;
          const mapP = new Map<string, number>();
          const mapC = new Map<string, number>();
          for (const r of rows) {
            const sac = String(r.SalesActivityCenter ?? '').trim() || '(Unknown)';
            if (sac !== centerKey) continue;
            const profit = toNumber(r.NetIncome, 0);
            const productName = String(r.Product ?? '').trim() || '(Unknown)';
            mapP.set(productName, (mapP.get(productName) ?? 0) + profit);
            allProducts.add(productName);
            const customerLabel = String(r.Customer ?? '').trim() || '(Unknown Customer)';
            mapC.set(customerLabel, (mapC.get(customerLabel) ?? 0) + profit);
            allCustomers.add(customerLabel);
          }
          byPeriodProduct.set(periodNo, mapP);
          byPeriodCustomer.set(periodNo, mapC);
        });
        if (allProducts.size === 0) {
          setDrilldown2ProductRows([]);
          setDrilldown2CustomerRows([]);
          setDrilldown2ProductMonthTotals([]);
          setDrilldown2CustomerMonthTotals([]);
          setDrilldown2Total(null);
          setDrilldown2Message(
            'By Product drill-down requires customer-product-profit data linked to Sales Activity Center (not available in current dataset).'
          );
          return;
        }
        const productTotals = Array.from(allProducts).map((name) => ({
          name,
          sum: drilldown2.periods.reduce(
            (s, p) => s + Math.abs(byPeriodProduct.get(p)?.get(name) ?? 0),
            0
          ),
        }));
        productTotals.sort((a, b) => b.sum - a.sum);
        const topProductNames = new Set(productTotals.slice(0, DRILLDOWN_TOP_PRODUCTS).map((x) => x.name));
        const productRows: GroupedBarRow[] = [];
        for (const { name } of productTotals.slice(0, DRILLDOWN_TOP_PRODUCTS)) {
          const values = drilldown2.periods.map((p) => ({
            x: p,
            y: byPeriodProduct.get(p)?.get(name) ?? 0,
          }));
          productRows.push({
            group: name,
            values,
            total: values.reduce((s, v) => s + v.y, 0),
          });
        }
        const othersSum = productTotals.slice(DRILLDOWN_TOP_PRODUCTS).reduce((s, x) => s + x.sum, 0);
        if (othersSum > 0 || productTotals.length > DRILLDOWN_TOP_PRODUCTS) {
          const othersValues = drilldown2.periods.map((p) => ({
            x: p,
            y: Array.from(allProducts)
              .filter((n) => !topProductNames.has(n))
              .reduce((s, n) => s + (byPeriodProduct.get(p)?.get(n) ?? 0), 0),
          }));
          productRows.push({
            group: 'Others',
            values: othersValues,
            total: othersValues.reduce((s, v) => s + v.y, 0),
          });
        }
        const productMonthTotals = drilldown2.periods.map((period) => ({
          period,
          total: productRows.reduce((s, row) => s + (row.values.find((v) => v.x === period)?.y ?? 0), 0),
        }));
        setDrilldown2ProductRows(productRows);
        setDrilldown2ProductMonthTotals(productMonthTotals);
        const panelTotal = productRows.reduce((s, r) => s + (r.total ?? 0), 0);
        setDrilldown2Total(panelTotal);

        const customerTotals = Array.from(allCustomers).map((label) => ({
          label,
          sum: drilldown2.periods.reduce(
            (s, p) => s + Math.abs(byPeriodCustomer.get(p)?.get(label) ?? 0),
            0
          ),
        }));
        customerTotals.sort((a, b) => b.sum - a.sum);
        const topCustomerLabels = new Set(customerTotals.slice(0, DRILLDOWN_TOP_CUSTOMERS).map((x) => x.label));
        const customerRows: GroupedBarRow[] = [];
        for (const { label } of customerTotals.slice(0, DRILLDOWN_TOP_CUSTOMERS)) {
          const values = drilldown2.periods.map((p) => ({
            x: p,
            y: byPeriodCustomer.get(p)?.get(label) ?? 0,
          }));
          customerRows.push({
            group: label,
            values,
            total: values.reduce((s, v) => s + v.y, 0),
          });
        }
        const othersCustomerSum = customerTotals.slice(DRILLDOWN_TOP_CUSTOMERS).reduce((s, x) => s + x.sum, 0);
        if (othersCustomerSum > 0 || customerTotals.length > DRILLDOWN_TOP_CUSTOMERS) {
          const othersValues = drilldown2.periods.map((p) => ({
            x: p,
            y: Array.from(allCustomers)
              .filter((n) => !topCustomerLabels.has(n))
              .reduce((s, n) => s + (byPeriodCustomer.get(p)?.get(n) ?? 0), 0),
          }));
          customerRows.push({
            group: 'Others',
            values: othersValues,
            total: othersValues.reduce((s, v) => s + v.y, 0),
          });
        }
        const customerMonthTotals = drilldown2.periods.map((period) => ({
          period,
          total: customerRows.reduce((s, row) => s + (row.values.find((v) => v.x === period)?.y ?? 0), 0),
        }));
        const sumCustomer = customerRows.reduce((s, r) => s + (r.total ?? 0), 0);
        if (Math.abs(sumCustomer - panelTotal) > 1e-6) {
          console.warn('[Drill-down 2] sumCustomer !== drilldown2Total', { sumCustomer, panelTotal });
        }
        setDrilldown2CustomerRows(customerRows);
        setDrilldown2CustomerMonthTotals(customerMonthTotals);
      })
      .catch(() => {
        if (!cancelled) {
          setDrilldown2ProductRows([]);
          setDrilldown2CustomerRows([]);
          setDrilldown2ProductMonthTotals([]);
          setDrilldown2CustomerMonthTotals([]);
          setDrilldown2Total(null);
          setDrilldown2Message(
            'By Product drill-down requires customer-product-profit data linked to Sales Activity Center (not available in current dataset).'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDrilldown2Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drilldown2]);

  const columns: ColumnDef<CustomerProfitResultRow, unknown>[] = [
    { accessorKey: 'customerId', header: 'CustomerID' },
    { accessorKey: 'Customer', header: 'Customer' },
    {
      accessorKey: 'Price',
      header: 'Price',
      cell: ({ getValue }) => formatMoney((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'SalesProfit',
      header: 'SalesProfit',
      cell: ({ getValue }) => formatMoney((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'ServiceCost',
      header: 'ServiceCost',
      cell: ({ getValue }) => formatMoney((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'CustomerProfit',
      header: 'CustomerProfit',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={v >= 0 ? 'profit-positive' : 'profit-negative'}>{formatMoney(v ?? 0)}</span>;
      },
    },
    {
      accessorKey: 'CustomerProfitRatio',
      header: 'CustomerProfitRatio',
      cell: ({ getValue }) => formatPercent(getValue() as number | null),
    },
  ];

  const handleRowClick = (row: CustomerProfitResultRow) => {
    if (isNaN(periodNo)) return;
    navigate(
      `/page1?periodNo=${periodNo}&customerId=${row.customerId}&company=${encodeURIComponent(row.company ?? '')}&buCode=${encodeURIComponent(row.buCode ?? '')}`
    );
  };

  /** 開啟 Customer Drill-down。與 SAC / Product 路徑互斥。 */
  const openCustomerDrill = (customerId: string, customerName: string) => {
    setDrilldown2(null);
    setProductDrill(null);
    setCustomerDrill({ customerId, customerName });
  };

  /** 開啟 Product Drill-down。與 Customer / SAC 路徑互斥。 */
  const openProductDrill = (productName: string) => {
    if (productName === 'Others') return;
    setCustomerDrill(null);
    setServiceCostDrill(null);
    setDrilldown2(null);
    setProductDrill({ productName });
  };

  const breadcrumb = [{ label: 'Customer Overview', path: `/page0?periodNo=${periodNo}` }];

  const chartFormatMoney = (y: number) => formatMoney(y);
  const chartFormatCount = (y: number) => String(Math.round(y));

  return (
    <>
      <div className={`page-split-layout${selectedPeriodNo != null ? ' panel-open' : ''}`}>
      <section className="trend-panel dashboard-section">
        <h2 className="trend-panel-title">Customer Overview Dashboard</h2>
        {dashboardLoading && <p className="trend-panel-message">Loading…</p>}
        {!dashboardLoading && dashboardError && <p className="trend-panel-message">No data</p>}
        {!dashboardLoading && !dashboardError && aggregates.length === 0 && (
          <p className="trend-panel-message">Upload data to see the dashboard.</p>
        )}
        {!dashboardLoading && !dashboardError && aggregates.length >= 1 && (
          <div className="dashboard-grid">
            <div className="dashboard-chart">
              <h3 className="dashboard-chart-title">Total Profitability</h3>
              <SimpleChart
                data={aggregates.map((a) => ({ x: a.periodNo, y: a.totalProfitability }))}
                type="bar"
                color="#2E7D32"
                barLabelFormatter={(v) => formatMoney(v)}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatMoney}
                width={340}
                height={200}
                onBarClick={(d) => {
                const p = Number(d.x);
                setSelectedPeriodNo(p);
                const periodList = aggregates.map((a) => a.periodNo);
                setSelectedPeriods(getPeriodRange(periodList, p));
                 // 新 drilldown 出現後，自動捲到 drilldown 區塊
  requestAnimationFrame(() => {
    railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
              }}
              />
            </div>
            <div className="dashboard-chart">
              <h3 className="dashboard-chart-title">Total Revenue</h3>
              <SimpleChart
                data={aggregates.map((a) => ({ x: a.periodNo, y: a.totalRevenue }))}
                type="bar"
                color="#1565C0"
                barLabelFormatter={(v) => formatMoney(v)}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatMoney}
                width={340}
                height={200}
              />
            </div>
            <div className="dashboard-chart">
              <h3 className="dashboard-chart-title">Total Service Cost</h3>
              <SimpleChart
                data={aggregates.map((a) => ({ x: a.periodNo, y: a.totalServiceCost }))}
                type="bar"
                color="#C62828"
                barLabelFormatter={(v) => formatMoney(v)}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatMoney}
                width={340}
                height={200}
              />
            </div>
            <div className="dashboard-chart">
              <h3 className="dashboard-chart-title">Customer Count</h3>
              <SimpleChart
                data={aggregates.map((a) => ({ x: a.periodNo, y: a.customerCount }))}
                type="line"
                xLabel="Period"
                yLabel="Count"
                formatX={(x) => String(x)}
                formatY={chartFormatCount}
                width={340}
                height={200}
              />
            </div>
          </div>
        )}
      </section>

      {selectedPeriodNo != null && (
        <aside ref={railRef} className="drill-side-panel">
          <div className="side-panel-nav">
            <div className="side-panel-crumbs">
              <button
                type="button"
                className={`crumb${activeLevel === 1 ? ' active' : ''}`}
                onClick={() => { setCustomerDrill(null); setProductDrill(null); setProductServiceCostDrill(null); setProductServiceCostCenterDrill(null); setDrilldown2(null); setServiceCostDrill(null); setCustomerActivityCenterDrill(null); setSacServiceCostDrill(null); setCompareServiceCostDrill(false); }}
              >
                {selectedPeriods.length <= 1
                  ? `Period ${selectedPeriodNo}`
                  : `Period ${selectedPeriods[0]}–${selectedPeriods[selectedPeriods.length - 1]}`}
              </button>
              {(customerDrill != null || productDrill != null || drilldown2 != null || serviceCostDrill != null || productServiceCostDrill != null || productServiceCostCenterDrill != null || compareServiceCostDrill) && (
                <>
                  <span className="crumb-sep">›</span>
                  <button
                    type="button"
                    className={`crumb${activeLevel === 2 ? ' active' : ''}`}
                    onClick={() => { setServiceCostDrill(null); setCustomerActivityCenterDrill(null); setProductServiceCostDrill(null); setProductServiceCostCenterDrill(null); setSacServiceCostDrill(null); setCompareServiceCostDrill(false); }}
                  >
                    {compareServiceCostDrill
                      ? 'Compare: Service Cost'
                      : customerDrill != null
                        ? customerDrill.customerName
                        : productDrill != null
                          ? productDrill.productName
                          : drilldown2?.salesActivityCenterKey ?? productServiceCostCenterDrill?.productName}
                  </button>
                </>
              )}
              {(serviceCostDrill != null || productServiceCostDrill != null || productServiceCostCenterDrill != null || sacServiceCostDrill != null) && (
                <>
                  <span className="crumb-sep">›</span>
                  <button
                    type="button"
                    className={`crumb${activeLevel === 3 ? ' active' : ''}`}
                    onClick={() => { setProductServiceCostCenterDrill(null); setSacServiceCostDrill(null); }}
                  >
                    Service Cost
                  </button>
                </>
              )}
              {productServiceCostCenterDrill != null && (
                <>
                  <span className="crumb-sep">›</span>
                  <span className="crumb active">{productServiceCostCenterDrill.centerKey}</span>
                </>
              )}
            </div>
            <button
              type="button"
              className="side-panel-close"
              onClick={() => { setSelectedPeriodNo(null); setSelectedPeriods([]); setCustomerDrill(null); setProductDrill(null); setProductServiceCostDrill(null); setProductServiceCostCenterDrill(null); setDrilldown2(null); setServiceCostDrill(null); setCustomerActivityCenterDrill(null); setSacServiceCostDrill(null); setCompareServiceCostDrill(false); }}
            >
              ✕ Close
            </button>
          </div>
          <div className="drilldown-rail drill-rail">
            {/* Column 1: Level 1 — By Customer / By Product / By SAC / Ranked / Distribution */}
            <div
  className={`drill-panel drilldown-rail-column level-1 ${activeLevel === 1 ? 'active' : 'inactive'} enter`}
>

              <div className="drill-panel-header drilldown-rail-column-header">
                <h3 className="drilldown-title drill-panel-title" style={{ margin: 0 }}>
                  {selectedPeriods.length === 0
                    ? `Drill-down: Period ${selectedPeriodNo}`
                    : selectedPeriods.length === 1
                      ? `Drill-down: Period ${selectedPeriods[0]}`
                      : `Drill-down: Period ${selectedPeriods[0]}–${selectedPeriods[selectedPeriods.length - 1]}`}
                </h3>
                <button
                  type="button"
                  className="drilldown-rail-close"
                  onClick={() => {
                    setSelectedPeriodNo(null);
                    setSelectedPeriods([]);
                  }}
                >
                  Close
                </button>
              </div>
              <div className="drill-panel-body drilldown-rail-column-body">
          <div className="drilldown-tabs">
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'whale' ? 'active' : ''}`}
              onClick={() => setDrilldownMode('whale')}
            >
              Whale Curve
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'customer' ? 'active' : ''}`}
              onClick={() => setDrilldownMode('customer')}
            >
              By Customer
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'product' ? 'active' : ''} ${!productDataAvailable ? 'disabled' : ''}`}
              onClick={() => productDataAvailable && setDrilldownMode('product')}
              disabled={!productDataAvailable}
            >
              By Product
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'salesActivityCenter' ? 'active' : ''} ${!salesActivityCenterDataAvailable ? 'disabled' : ''}`}
              onClick={() => salesActivityCenterDataAvailable && setDrilldownMode('salesActivityCenter')}
              disabled={!salesActivityCenterDataAvailable}
              title={!salesActivityCenterDataAvailable ? 'Sales Activity Center data is not available in the current dataset.' : undefined}
            >
              By Sales Activity Center
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'ranked' ? 'active' : ''}`}
              onClick={() => setDrilldownMode('ranked')}
            >
              Ranked List
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'hist' ? 'active' : ''}`}
              onClick={() => setDrilldownMode('hist')}
            >
              Distribution
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'compare' ? 'active' : ''}`}
              onClick={() => setDrilldownMode('compare')}
            >
              Compare
            </button>
          </div>

          {loadingDrilldown && <p className="trend-panel-message">Loading drill-down…</p>}
          {errorDrilldown && <p className="trend-panel-message">{errorDrilldown}</p>}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'whale' && (() => {
            if (drilldownRows.length === 0) return <p className="trend-panel-message">No customer data for this period.</p>;

            type WhalePt = { rank: number; cum: number; value: number };
            const buildPts = (getValue: (r: typeof drilldownRows[0]) => number, sortDesc = true): WhalePt[] => {
              const rows = [...drilldownRows].sort((a, b) => sortDesc ? getValue(b) - getValue(a) : getValue(a) - getValue(b));
              let cum = 0;
              return rows.map((r, i) => { cum += getValue(r); return { rank: i + 1, cum, value: getValue(r) }; });
            };

            const renderWhale = (
              pts: WhalePt[],
              title: string,
              lineColor: string,
              gradId: string,
              xLabel: string,
              allowNeg: boolean
            ) => {
              const n = pts.length;
              const total = pts[n - 1]?.cum ?? 0;
              const peakIdx = pts.reduce((best, p, i) => p.cum > (pts[best]?.cum ?? -Infinity) ? i : best, 0);
              const peakVal = pts[peakIdx]?.cum ?? 0;
              const peakRank = peakIdx + 1;
              const breakEvenIdx = allowNeg ? pts.findIndex((p) => p.cum < 0) : -1;
              const top20Count = Math.max(1, Math.round(n * 0.2));
              const top20Val = pts[top20Count - 1]?.cum ?? 0;

              const W = 540, H = 210;
              const PAD = { top: 28, right: 18, bottom: 36, left: 74 };
              const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
              const yVals = pts.map((p) => p.cum);
              const yMin = allowNeg ? Math.min(0, ...yVals) : 0;
              const yMax = Math.max(0, ...yVals);
              const yRange = yMax - yMin || 1;
              const sx = (r: number) => ((r - 1) / Math.max(n - 1, 1)) * cW;
              const sy = (y: number) => cH - ((y - yMin) / yRange) * cH;
              const zeroY = sy(0);
              const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.rank).toFixed(1)} ${sy(p.cum).toFixed(1)}`).join(' ');
              const areaPath = `M ${sx(1).toFixed(1)} ${zeroY.toFixed(1)} ` + pts.map((p) => `L ${sx(p.rank).toFixed(1)} ${sy(p.cum).toFixed(1)}`).join(' ') + ` L ${sx(n).toFixed(1)} ${zeroY.toFixed(1)} Z`;
              const zeroFrac = (zeroY / cH) * 100;
              const yTicks = Array.from(new Set([yMin, yMax, 0])).sort((a, b) => b - a);

              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: '#222' }}>{title}</div>
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', overflow: 'visible' }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={`${Math.max(0, zeroFrac - 0.5).toFixed(1)}%`} stopColor="#4CAF50" stopOpacity="0.2" />
                        <stop offset={`${Math.min(100, zeroFrac + 0.5).toFixed(1)}%`} stopColor="#F44336" stopOpacity="0.2" />
                      </linearGradient>
                    </defs>
                    <g transform={`translate(${PAD.left},${PAD.top})`}>
                      <path d={areaPath} fill={`url(#${gradId})`} />
                      {zeroY >= 0 && zeroY <= cH && <line x1={0} y1={zeroY} x2={cW} y2={zeroY} stroke="#aaa" strokeDasharray="5,4" strokeWidth={1} />}
                      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinejoin="round" />
                      <circle cx={sx(peakRank)} cy={sy(peakVal)} r={5} fill="#2E7D32" />
                      <text x={sx(peakRank)} y={sy(peakVal) - 10} textAnchor={peakRank > n * 0.7 ? 'end' : 'middle'} fontSize={10} fill="#2E7D32" fontWeight="600">
                        Peak {formatMoney(peakVal)}
                      </text>
                      {breakEvenIdx > 0 && (
                        <>
                          <line x1={sx(breakEvenIdx + 1)} y1={0} x2={sx(breakEvenIdx + 1)} y2={cH} stroke="#E65100" strokeDasharray="4,3" strokeWidth={1.5} />
                          <text x={sx(breakEvenIdx + 1) + 4} y={10} fontSize={10} fill="#E65100">Loss starts #{breakEvenIdx + 1}</text>
                        </>
                      )}
                      <line x1={0} y1={0} x2={0} y2={cH} stroke="#ddd" />
                      <line x1={0} y1={cH} x2={cW} y2={cH} stroke="#ddd" />
                      {yTicks.map((v, i) => (
                        <g key={i}>
                          <line x1={-4} y1={sy(v)} x2={0} y2={sy(v)} stroke="#aaa" />
                          <text x={-8} y={sy(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#555">{v === 0 ? '$0' : formatMoney(v)}</text>
                        </g>
                      ))}
                      <text x={cW / 2} y={cH + 28} textAnchor="middle" fontSize={11} fill="#666">{xLabel} ({n} customers)</text>
                    </g>
                  </svg>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
                    <div style={{ background: '#e8f5e9', borderRadius: 6, padding: '6px 10px' }}>
                      <div style={{ fontSize: 10, color: '#555' }}>Peak (top {peakRank})</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#2E7D32' }}>{formatMoney(peakVal)}</div>
                    </div>
                    <div style={{ background: total >= 0 ? '#e8f5e9' : '#fce4ec', borderRadius: 6, padding: '6px 10px' }}>
                      <div style={{ fontSize: 10, color: '#555' }}>Total (all customers)</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: total >= 0 ? '#2E7D32' : '#C62828' }}>{formatMoney(total)}</div>
                    </div>
                    <div style={{ background: '#e3f2fd', borderRadius: 6, padding: '6px 10px' }}>
                      <div style={{ fontSize: 10, color: '#555' }}>Top 20% ({top20Count})</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1565C0' }}>{formatMoney(top20Val)}</div>
                    </div>
                  </div>
                </div>
              );
            };

            const profitPts = buildPts((r) => toNumber(r.CustomerProfit, 0));
            const revPts    = buildPts((r) => toNumber(r.Price, 0));

            return (
              <>
                {renderWhale(profitPts, 'Cumulative Profitability Whale Curve', '#1565C0', 'whale-grad-profit', 'Customers ranked by profitability', true)}
                {renderWhale(revPts,    'Cumulative Revenue Whale Curve',        '#6A1B9A', 'whale-grad-rev',    'Customers ranked by revenue',        false)}
                <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Switch to By Customer to drill into individual customers.</p>
              </>
            );
          })()}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'ranked' && (
            <>
              {drilldownRows.length > 0 && (
                <>
                  <div className="drilldown-summary">
                    <span>Customers: {drilldownRows.length}</span>
                    <span>Total Profit: {formatMoney(drilldownRows.reduce((s, r) => s + toNumber(r.CustomerProfit, 0), 0))}</span>
                    <span>Avg Profit: {formatMoney(drilldownRows.length ? drilldownRows.reduce((s, r) => s + toNumber(r.CustomerProfit, 0), 0) / drilldownRows.length : 0)}</span>
                    <span>Median: {formatMoney(median(drilldownRows.map((r) => toNumber(r.CustomerProfit, 0)).sort((a, b) => a - b)))}</span>
                  </div>
                  <div className="top-n-row">
                    <label>
                      Top N:{' '}
                      <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="top-n-select">
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowAllRanked(!showAllRanked)}
                    >
                      {showAllRanked ? 'Show Top N Only' : 'Show All'}
                    </button>
                  </div>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="num">#</th>
                          <th className="label">CustomerID</th>
                          <th className="label">Customer</th>
                          <th className="num">CustomerProfit</th>
                          <th className="num">Revenue (Price)</th>
                          <th className="num">ServiceCost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllRanked ? drilldownRows : drilldownRows.slice(0, topN)).map((r, i) => (
                          <tr key={`${r.customerId}-${i}`}>
                            <td className="num">{i + 1}</td>
                            <td className="label">{String(r.CustomerID ?? r.customerId ?? '')}</td>
                            <td className="label">{String(r.Customer ?? '')}</td>
                            <td className={`num ${toNumber(r.CustomerProfit, 0) >= 0 ? 'profit-positive' : 'profit-negative'}`}>
                              {formatMoney(toNumber(r.CustomerProfit, 0))}
                            </td>
                            <td className="num">{formatMoney(toNumber(r.Price, 0))}</td>
                            <td className="num">{formatMoney(toNumber(r.ServiceCost, 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {drilldownRows.length === 0 && <p className="trend-panel-message">No customer data for this period.</p>}
            </>
          )}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'hist' && (
            <>
              {histBins.length > 0 ? (
                <SimpleChart
                  data={histBins.map((b, i) => ({ x: i, y: b.count }))}
                  type="bar"
                  xLabel="Profit interval"
                  yLabel="Count"
                  formatX={(x) => histBins[x]?.label ?? String(x)}
                  formatY={(y) => String(Math.round(y))}
                  width={600}
                  height={260}
                />
              ) : (
                <p className="trend-panel-message">No data for histogram.</p>
              )}
            </>
          )}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'compare' && (() => {
            const availableItems: { key: string; label: string; profit?: number }[] =
              compareType === 'product'
                ? allProductsForCompare.map((r) => ({ key: r.name, label: r.name, profit: r.profit }))
                : compareType === 'sac'
                  ? allSacForCompare.map((r) => ({ key: r.name, label: r.name, profit: r.profit }))
                  : allCustomersForCompare.map((r) => ({ key: r.key, label: r.label, profit: r.profit }));

            const readyItems = compareSelected.filter((item) => compareMetricsMap[item.key]);
            const chartRows: GroupedBarRow[] = readyItems.length >= 1 ? [
              { group: 'Revenue',         values: compareSelected.map((item, idx) => ({ x: idx, y: compareMetricsMap[item.key]?.revenue ?? 0 })) },
              { group: 'COGS',            values: compareSelected.map((item, idx) => ({ x: idx, y: compareMetricsMap[item.key]?.cogs ?? 0 })) },
              { group: 'Service Cost',    values: compareSelected.map((item, idx) => ({ x: idx, y: compareMetricsMap[item.key]?.serviceCost ?? 0 })) },
              { group: 'Mgmt Cost',       values: compareSelected.map((item, idx) => ({ x: idx, y: compareMetricsMap[item.key]?.managementCost ?? 0 })) },
              { group: 'Profit',          values: compareSelected.map((item, idx) => ({ x: idx, y: compareMetricsMap[item.key]?.profit ?? 0 })) },
            ] : [];
            const compareMonthTotals = compareSelected.map((item, idx) => ({
              period: idx,
              total: compareMetricsMap[item.key]?.profit ?? 0,
            }));
            const tableData: Record<string, string | number>[] = [
              { metric: 'Revenue',         ...Object.fromEntries(compareSelected.map((item) => [item.label, formatMoney(compareMetricsMap[item.key]?.revenue ?? 0)])) },
              { metric: 'COGS',            ...Object.fromEntries(compareSelected.map((item) => [item.label, formatMoney(compareMetricsMap[item.key]?.cogs ?? 0)])) },
              { metric: 'Service Cost',    ...Object.fromEntries(compareSelected.map((item) => [item.label, formatMoney(compareMetricsMap[item.key]?.serviceCost ?? 0)])) },
              { metric: 'Mgmt Cost',       ...Object.fromEntries(compareSelected.map((item) => [item.label, formatMoney(compareMetricsMap[item.key]?.managementCost ?? 0)])) },
              { metric: 'Profit',          ...Object.fromEntries(compareSelected.map((item) => [item.label, formatMoney(compareMetricsMap[item.key]?.profit ?? 0)])) },
            ];
            const tableCols: ColumnDef<Record<string, string | number>, unknown>[] = [
              { accessorKey: 'metric', header: 'Metric' },
              ...compareSelected.map((item) => ({
                accessorKey: item.label,
                header: item.label,
                cell: ({ getValue, row }: { getValue: () => unknown; row: { original: Record<string, string | number> } }) => {
                  const raw = String(getValue() ?? '');
                  const isProfit = row.original.metric === 'Profit';
                  if (!isProfit) return raw;
                  const numVal = compareMetricsMap[item.key]?.profit ?? 0;
                  return <span className={numVal >= 0 ? 'profit-positive' : 'profit-negative'}>{raw}</span>;
                },
              })),
            ];
            return (
              <>
                {/* Type selector */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {(['product', 'sac', 'customer'] as const).map((t) => (
                    <button key={t} type="button"
                      className={compareType === t ? 'btn btn-primary' : 'btn'}
                      style={{ fontSize: 12, padding: '3px 10px' }}
                      onClick={() => { setCompareType(t); setCompareSelected([]); setCompareMetricsMap({}); }}
                    >
                      {t === 'product' ? 'Product' : t === 'sac' ? 'Activity Center' : 'Customer'}
                    </button>
                  ))}
                </div>

                {/* Selected chips */}
                {compareSelected.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {compareSelected.map((item) => (
                      <span key={item.key} style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 12, padding: '2px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {item.label}
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', lineHeight: 1, fontSize: 14, padding: 0 }}
                          onClick={() => setCompareSelected((prev) => prev.filter((i) => i.key !== item.key))}>×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Item list */}
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14 }}>
                  {availableItems.length === 0 && <p style={{ padding: '8px 12px', fontSize: 12, color: '#888', margin: 0 }}>No items available for this period.</p>}
                  {availableItems.map((item) => {
                    const isSelected = compareSelected.some((i) => i.key === item.key);
                    const disabled = !isSelected && compareSelected.length >= 3;
                    const profitColor = item.profit != null ? (item.profit >= 0 ? '#2E7D32' : '#C62828') : '#888';
                    return (
                      <button key={item.key} type="button"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', background: isSelected ? '#e8f5e9' : 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 13 }}
                        onClick={() => {
                          if (isSelected) setCompareSelected((prev) => prev.filter((i) => i.key !== item.key));
                          else if (!disabled) setCompareSelected((prev) => [...prev, { key: item.key, label: item.label }]);
                        }}
                      >
                        <span style={{ width: 16, flexShrink: 0, textAlign: 'center', color: '#2E7D32', fontWeight: 700 }}>{isSelected ? '✓' : ''}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                        {item.profit != null && (
                          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: profitColor, minWidth: 80, textAlign: 'right' }}>
                            {formatMoney(item.profit)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {compareSelected.length === 0 && <p className="trend-panel-message">Select 2–3 items above to compare.</p>}
                {compareLoading && <p className="trend-panel-message">Loading…</p>}

                {/* Comparison chart */}
                {!compareLoading && compareSelected.length >= 2 && readyItems.length >= 2 && (
                  <>
                    <div className="drill-chart" style={{ marginBottom: 12 }}>
                      <GroupedBarRows
                        rows={chartRows}
                        formatPeriod={(x) => compareSelected[Number(x)]?.label ?? String(x)}
                        barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                        barLabelFormatter={(y) => formatMoney(y)}
                        totalFormatter={formatMoney}
                        labelWidth={120}
                        monthTotals={compareMonthTotals}
                        labelColumnTitle="Metric"
                        onRowClick={({ label }) => { if (label === 'Service Cost') setCompareServiceCostDrill(true); }}
                      />
                    </div>
                    <DataTable data={tableData} columns={tableCols} searchable={false} pageSize={10} sortable={false}
                      onRowClick={(row) => { if (String(row.metric) === 'Service Cost') setCompareServiceCostDrill(true); }}
                    />
                  </>
                )}
              </>
            );
          })()}

{!loadingDrilldown && !errorDrilldown && drilldownMode === 'customer' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`btn ${customerSortMode === 'top' ? 'btn-primary' : ''}`}
                  onClick={() => setCustomerSortMode('top')}
                >
                  Top 20
                </button>
                <button
                  type="button"
                  className={`btn ${customerSortMode === 'bottom' ? 'btn-primary' : ''}`}
                  onClick={() => setCustomerSortMode('bottom')}
                >
                  Bottom 20
                </button>
              </div>
              {groupedCustomerRows.length > 0 ? (
                <GroupedBarRows
                  rows={groupedCustomerRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => formatMoney(y)}
                  totalFormatter={formatMoney}
                  labelWidth={160}
                  monthTotals={customerMonthTotals}
                  labelColumnTitle="Customer"
                  onRowClick={(row) => {
                    if (row.key) openCustomerDrill(row.key, row.label);
                  }}
                  onBarClick={({ groupLabel, dataKey }) => {
                    if (dataKey) openCustomerDrill(dataKey, groupLabel);
                  }}
                />
              ) : (
                <p className="trend-panel-message">No customer data for selected period(s).</p>
              )}
            </>
          )}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'product' && (
            <>
              {productDataAvailable && groupedProductRows.length > 0 ? (
                <GroupedBarRows
                  rows={groupedProductRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => formatMoney(y)}
                  totalFormatter={formatMoney}
                  width={360}
                  labelWidth={120}
                  onRowClick={({ label }) => openProductDrill(label)}
                />
              ) : productDataAvailable ? (
                <p className="trend-panel-message">No product data for selected period(s).</p>
              ) : (
                <p className="trend-panel-message">Product view requires ProductProfitResult data. Please upload data with ProductProfitResult.</p>
              )}
            </>
          )}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'salesActivityCenter' && (
            <>
              {salesActivityCenterDataAvailable && groupedSalesActivityCenterRows.length > 0 ? (
                <GroupedBarRows
                  rows={groupedSalesActivityCenterRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => formatMoney(y)}
                  totalFormatter={formatMoney}
                  width={360}
                  labelWidth={120}
                  monthTotals={salesActivityCenterMonthTotals}
                  onBarClick={({ groupLabel, period }) => {
                    setCustomerDrill(null);
                    setServiceCostDrill(null);
                    setDrilldown2Mode('product');
                    setDrilldown2({
                      salesActivityCenterKey: groupLabel,
                      clickedPeriodNo: period,
                      periods: selectedPeriods,
                    });
                  }}
                  onRowClick={({ label }) => {
                    setCustomerDrill(null);
                    setServiceCostDrill(null);
                    setDrilldown2Mode('product');
                    setDrilldown2({
                      salesActivityCenterKey: label,
                      clickedPeriodNo: selectedPeriods[selectedPeriods.length - 1] ?? selectedPeriodNo ?? 0,
                      periods: selectedPeriods,
                    });
                  }}
                />
              ) : salesActivityCenterDataAvailable ? (
                <p className="trend-panel-message">No Sales Activity Center data for selected period(s).</p>
              ) : (
                <p className="trend-panel-message">
                  Sales Activity Center data is not available in the current dataset.
                </p>
              )}
            </>
          )}

</div>
            </div>


            {/* Column 2: Level 2 — Customer metrics (Customer path) or SAC → Product/Customer */}
            {customerDrill != null && (

  <div ref={level2Ref} className={`drilldown-rail-column level-2 ${activeLevel === 2 ? 'active' : 'inactive'}`}>

                <div className="drilldown-rail-column-header">
                  <span>Customer: {customerDrill.customerName}</span>
                  <button
                    type="button"
                    className="drilldown-rail-close"
                    onClick={() => {
                      setCustomerDrill(null);
                      setServiceCostDrill(null);
                    }}
                  >
                    Close
                  </button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {customerDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!customerDrillLoading && customerDrillMetrics.length > 0 && (() => {
                    const periodKeys = customerDrillMetrics.map((m) => String(m.periodNo));
                    const customerMetricChartRows: GroupedBarRow[] = [
                      { group: 'Customer Revenue', values: customerDrillMetrics.map((m) => ({ x: m.periodNo, y: m.revenue })), total: customerDrillMetrics.reduce((s, m) => s + m.revenue, 0) },
                      { group: 'COGS', values: customerDrillMetrics.map((m) => ({ x: m.periodNo, y: m.cogs })), total: customerDrillMetrics.reduce((s, m) => s + m.cogs, 0) },
                      { group: 'Service Cost', values: customerDrillMetrics.map((m) => ({ x: m.periodNo, y: m.serviceCost })), total: customerDrillMetrics.reduce((s, m) => s + m.serviceCost, 0) },
                      { group: 'Management Cost', values: customerDrillMetrics.map((m) => ({ x: m.periodNo, y: m.managementCost })), total: customerDrillMetrics.reduce((s, m) => s + m.managementCost, 0) },
                    ];
                    const customerMetricMonthTotals = selectedPeriods.map((periodNo) => ({
                      period: periodNo,
                      total: customerDrillMetrics.filter((m) => m.periodNo === periodNo).reduce((s, m) => s + m.revenue + m.cogs + m.serviceCost + m.managementCost, 0),
                    }));
                    const customerDrillData: Record<string, string | number>[] = [
                      { metric: 'Customer Revenue', ...Object.fromEntries(customerDrillMetrics.map((m) => [String(m.periodNo), m.revenue])) },
                      { metric: 'COGS', ...Object.fromEntries(customerDrillMetrics.map((m) => [String(m.periodNo), m.cogs])) },
                      { metric: 'Service Cost', ...Object.fromEntries(customerDrillMetrics.map((m) => [String(m.periodNo), m.serviceCost])) },
                      { metric: 'Management Cost', ...Object.fromEntries(customerDrillMetrics.map((m) => [String(m.periodNo), m.managementCost])) },
                      { metric: 'Customer Profitability', ...Object.fromEntries(customerDrillMetrics.map((m) => [String(m.periodNo), m.revenue - m.cogs - m.serviceCost - m.managementCost])) },
                    ];
                    const customerDrillColumns: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'metric', header: 'Metric' },
                      ...periodKeys.map((p) => ({
                        accessorKey: p,
                        header: formatMonthMMYYYY(Number(p)),
                        cell: ({ getValue, row }: { getValue: () => unknown; row: { original: Record<string, string | number> } }) => {
                          const value = Number(getValue() ?? 0);
                          const formatted = formatMoney(value);
                          return row.original.metric === 'Customer Profitability' ? (
                            <span className={value >= 0 ? 'profit-positive' : 'profit-negative'}>{formatted}</span>
                          ) : (
                            formatted
                          );
                        },
                      })),
                    ];
                    return (
                      <>
                        <div className="drill-chart" style={{ marginBottom: 12 }}>
                          <GroupedBarRows
                            rows={customerMetricChartRows}
                            formatPeriod={(x) => formatMonthMMYYYY(x)}
                            barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                            barLabelFormatter={(y) => formatMoney(y)}
                            totalFormatter={formatMoney}
                            width={320}
                            labelWidth={120}
                            monthTotals={customerMetricMonthTotals}
                            onRowClick={({ label }) => {
                              if (label === 'Service Cost') {
                                setServiceCostDrill({ customerId: customerDrill.customerId, customerName: customerDrill.customerName });
                              }
                            }}
                          />
                        </div>
                        <DataTable
                          data={customerDrillData}
                          columns={customerDrillColumns}
                          searchable={false}
                          pageSize={10}
                          sortable={false}
                          onRowClick={(row) => {
                            if (String(row.metric) === 'Service Cost') {
                              setServiceCostDrill({ customerId: customerDrill.customerId, customerName: customerDrill.customerName });
                            }
                          }}
                        />
                      </>
                    );
                  })()}
                  {!customerDrillLoading && customerDrillMetrics.length === 0 && (
                    <p className="trend-panel-message">No metrics for this customer.</p>
                  )}
                </div>
              </div>
            )}
           {/* Product Drill-down: level 2 */}
           {productDrill != null && customerDrill == null && drilldown2 == null && (
  <div
    ref={level2Ref}
    className={`drill-panel drilldown-rail-column level-2 ${activeLevel === 2 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Product: {productDrill.productName}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setProductDrill(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {productDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!productDrillLoading && productDrillMetrics.length > 0 && (() => {
                    const periodKeys = productDrillMetrics.map((m) => String(m.periodNo));
                    const productMetricChartRows: GroupedBarRow[] = [
                      { group: 'Product Revenue', values: productDrillMetrics.map((m) => ({ x: m.periodNo, y: m.revenue })), total: productDrillMetrics.reduce((s, m) => s + m.revenue, 0) },
                      { group: 'COGS', values: productDrillMetrics.map((m) => ({ x: m.periodNo, y: m.cogs })), total: productDrillMetrics.reduce((s, m) => s + m.cogs, 0) },
                      { group: 'Service Cost', values: productDrillMetrics.map((m) => ({ x: m.periodNo, y: m.serviceCost })), total: productDrillMetrics.reduce((s, m) => s + m.serviceCost, 0) },
                      { group: 'Management Cost', values: productDrillMetrics.map((m) => ({ x: m.periodNo, y: m.managementCost })), total: productDrillMetrics.reduce((s, m) => s + m.managementCost, 0) },
                      { group: 'Product Profitability', values: productDrillMetrics.map((m) => ({ x: m.periodNo, y: m.productProfit })), total: productDrillMetrics.reduce((s, m) => s + m.productProfit, 0) },
                    ];
                    const productMonthTotals = selectedPeriods.map((periodNo) => ({
                      period: periodNo,
                      total: productDrillMetrics.filter((m) => m.periodNo === periodNo).reduce((s, m) => s + m.productProfit, 0),
                    }));
                    const productDrillData: Record<string, string | number>[] = [
                      { metric: 'Product Revenue', ...Object.fromEntries(productDrillMetrics.map((m) => [String(m.periodNo), m.revenue])) },
                      { metric: 'COGS', ...Object.fromEntries(productDrillMetrics.map((m) => [String(m.periodNo), m.cogs])) },
                      { metric: 'Service Cost', ...Object.fromEntries(productDrillMetrics.map((m) => [String(m.periodNo), m.serviceCost])) },
                      { metric: 'Management Cost', ...Object.fromEntries(productDrillMetrics.map((m) => [String(m.periodNo), m.managementCost])) },
                      { metric: 'Product Profitability', ...Object.fromEntries(productDrillMetrics.map((m) => [String(m.periodNo), m.productProfit])) },
                    ];
                    const productDrillColumns: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'metric', header: 'Metric' },
                      ...periodKeys.map((p) => ({
                        accessorKey: p,
                        header: formatMonthMMYYYY(Number(p)),
                        cell: ({ getValue, row }: { getValue: () => unknown; row: { original: Record<string, string | number> } }) => {
                          const value = Number(getValue() ?? 0);
                          const formatted = formatMoney(value);
                          return row.original.metric === 'Product Profitability' ? (
                            <span className={value >= 0 ? 'profit-positive' : 'profit-negative'}>{formatted}</span>
                          ) : (
                            formatted
                          );
                        },
                      })),
                    ];
                    return (
                      <>
                        <div className="drill-chart" style={{ marginBottom: 12 }}>
                          <GroupedBarRows
                            rows={productMetricChartRows}
                            formatPeriod={(x) => formatMonthMMYYYY(x)}
                            barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                            barLabelFormatter={(y) => formatMoney(y)}
                            totalFormatter={formatMoney}
                            labelWidth={140}
                            monthTotals={productMonthTotals}
                            labelColumnTitle="Metric"
                            onRowClick={({ label }) => {
                              if (label === 'Service Cost') {
                                setProductServiceCostDrill({ productName: productDrill.productName });
                              }
                            }}
                          />
                        </div>
                        <DataTable
                          data={productDrillData}
                          columns={productDrillColumns}
                          searchable={false}
                          pageSize={10}
                          sortable={false}
                          onRowClick={(row) => {
                            if (String(row.metric) === 'Service Cost') {
                              setProductServiceCostDrill({ productName: productDrill.productName });
                            }
                          }}
                        />
                      </>
                    );
                  })()}
                  {!productDrillLoading && productDrillMetrics.length === 0 && (
                    <p className="trend-panel-message">No metrics for this product.</p>
                  )}
                </div>
              </div>
            )}

           {customerDrill == null && drilldown2 != null && (
  <div
    ref={level2Ref}
    className={`drill-panel drilldown-rail-column level-2 ${activeLevel === 2 ? 'active' : 'inactive'} enter`}
  >

                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">SAC: {drilldown2.salesActivityCenterKey}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setDrilldown2(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {/* Financial Metrics */}
                  {sacDrillMetricsLoading && <p className="trend-panel-message">Loading metrics…</p>}
                  {!sacDrillMetricsLoading && sacDrillMetrics.length > 0 && (() => {
                    const periodKeys = sacDrillMetrics.map((m) => String(m.periodNo));
                    const sacMetricChartRows: GroupedBarRow[] = [
                      { group: 'Revenue', values: sacDrillMetrics.map((m) => ({ x: m.periodNo, y: m.revenue })), total: sacDrillMetrics.reduce((s, m) => s + m.revenue, 0) },
                      { group: 'COGS', values: sacDrillMetrics.map((m) => ({ x: m.periodNo, y: m.cogs })), total: sacDrillMetrics.reduce((s, m) => s + m.cogs, 0) },
                      { group: 'Service Cost', values: sacDrillMetrics.map((m) => ({ x: m.periodNo, y: m.serviceCost })), total: sacDrillMetrics.reduce((s, m) => s + m.serviceCost, 0) },
                      { group: 'Management Cost', values: sacDrillMetrics.map((m) => ({ x: m.periodNo, y: m.managementCost })), total: sacDrillMetrics.reduce((s, m) => s + m.managementCost, 0) },
                      { group: 'Profitability', values: sacDrillMetrics.map((m) => ({ x: m.periodNo, y: m.profitability })), total: sacDrillMetrics.reduce((s, m) => s + m.profitability, 0) },
                    ];
                    const sacMonthTotals = drilldown2.periods.map((periodNo) => ({
                      period: periodNo,
                      total: sacDrillMetrics.find((m) => m.periodNo === periodNo)?.profitability ?? 0,
                    }));
                    const sacMetricData: Record<string, string | number>[] = [
                      { metric: 'Revenue', ...Object.fromEntries(sacDrillMetrics.map((m) => [String(m.periodNo), m.revenue])) },
                      { metric: 'COGS', ...Object.fromEntries(sacDrillMetrics.map((m) => [String(m.periodNo), m.cogs])) },
                      { metric: 'Service Cost', ...Object.fromEntries(sacDrillMetrics.map((m) => [String(m.periodNo), m.serviceCost])) },
                      { metric: 'Management Cost', ...Object.fromEntries(sacDrillMetrics.map((m) => [String(m.periodNo), m.managementCost])) },
                      { metric: 'Profitability', ...Object.fromEntries(sacDrillMetrics.map((m) => [String(m.periodNo), m.profitability])) },
                    ];
                    const sacMetricCols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'metric', header: 'Metric' },
                      ...periodKeys.map((p) => ({
                        accessorKey: p,
                        header: formatMonthMMYYYY(Number(p)),
                        cell: ({ getValue, row }: { getValue: () => unknown; row: { original: Record<string, string | number> } }) => {
                          const value = Number(getValue() ?? 0);
                          return row.original.metric === 'Profitability' ? (
                            <span className={value >= 0 ? 'profit-positive' : 'profit-negative'}>{formatMoney(value)}</span>
                          ) : formatMoney(value);
                        },
                      })),
                    ];
                    return (
                      <>
                        <div className="drill-chart" style={{ marginBottom: 12 }}>
                          <GroupedBarRows
                            rows={sacMetricChartRows}
                            formatPeriod={(x) => formatMonthMMYYYY(x)}
                            barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                            barLabelFormatter={(y) => formatMoney(y)}
                            totalFormatter={formatMoney}
                            labelWidth={140}
                            monthTotals={sacMonthTotals}
                            labelColumnTitle="Metric"
                            onRowClick={({ label }) => {
                              if (label === 'Service Cost') setSacServiceCostDrill({ sacKey: drilldown2.salesActivityCenterKey });
                            }}
                          />
                        </div>
                        <DataTable data={sacMetricData} columns={sacMetricCols} searchable={false} pageSize={10} sortable={false}
                          onRowClick={(row) => {
                            if (String(row.metric) === 'Service Cost') setSacServiceCostDrill({ sacKey: drilldown2.salesActivityCenterKey });
                          }}
                        />
                      </>
                    );
                  })()}
                  {/* Product / Customer breakdown */}
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12 }}>
                    {drilldown2Total != null && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555' }}>Net Profitability Total: <strong>{formatMoney(drilldown2Total)}</strong></p>}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <button type="button" className={drilldown2Mode === 'product' ? 'btn btn-primary' : 'btn'} onClick={() => setDrilldown2Mode('product')}>By Product</button>
                      <button type="button" className={drilldown2Mode === 'customer' ? 'btn btn-primary' : 'btn'} onClick={() => setDrilldown2Mode('customer')}>By Customer</button>
                    </div>
                    {drilldown2Loading && <p className="trend-panel-message">Loading…</p>}
                    {!drilldown2Loading && drilldown2Message != null && <p className="trend-panel-message">{drilldown2Message}</p>}
                    {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'product' && drilldown2ProductRows.length > 0 && (
                      <GroupedBarRows rows={drilldown2ProductRows} formatPeriod={(x) => formatMonthMMYYYY(x)} barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')} barLabelFormatter={(y) => formatMoney(y)} totalFormatter={formatMoney} width={320} labelWidth={100} monthTotals={drilldown2ProductMonthTotals} labelColumnTitle="Product" />
                    )}
                    {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'customer' && drilldown2CustomerRows.length > 0 && (
                      <GroupedBarRows rows={drilldown2CustomerRows} formatPeriod={(x) => formatMonthMMYYYY(x)} barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')} barLabelFormatter={(y) => formatMoney(y)} totalFormatter={formatMoney} width={320} labelWidth={100} monthTotals={drilldown2CustomerMonthTotals} labelColumnTitle="Customer" />
                    )}
                    {!drilldown2Loading && drilldown2Message == null && drilldown2ProductRows.length === 0 && drilldown2CustomerRows.length === 0 && (
                      <p className="trend-panel-message">No data for this SAC in selected periods.</p>
                    )}
                  </div>
                </div>
              </div>
            )}






            {/* Column 3: Level 3 — Service Cost Breakdown (Customer path only) */}
            {serviceCostDrill != null && (
  <div
    ref={level3Ref}
    className={`drill-panel drilldown-rail-column level-3 ${activeLevel === 3 ? 'active' : 'inactive'} enter`}
  >

                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Service Cost Breakdown</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => { setServiceCostDrill(null); setCustomerActivityCenterDrill(null); }}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {serviceCostDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!serviceCostDrillLoading && serviceCostDrillPeriodTotals.length > 0 && (
                    <p style={{ marginBottom: 8, fontSize: 12, color: '#555' }}>
                      Total by period: {serviceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => `${formatMonthMMYYYY(periodNo)}: ${formatMoney(totalCost)}`).join(' · ')}
                    </p>
                  )}
                  {!serviceCostDrillLoading && serviceCostDrillRows.length > 0 && (() => {
                    const activityRows = serviceCostDrillRows;
                    const totalRow: Record<string, string | number> = { activity: 'Total' };
                    (totalRow as Record<string, unknown>)['isTotal'] = true;
                    for (const p of selectedPeriods) {
                      totalRow[`${p}_hours`] = activityRows.reduce((s, r) => s + Number(r[`${p}_hours`] ?? 0), 0);
                      totalRow[`${p}_cost`] = activityRows.reduce((s, r) => s + Number(r[`${p}_cost`] ?? 0), 0);
                    }
                    const rowsWithTotal = [...activityRows, totalRow];
                    const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
                    const sortedByLatestCost = [...activityRows].sort((a, b) => Number(b[`${lastPeriod}_cost`] ?? 0) - Number(a[`${lastPeriod}_cost`] ?? 0));
                    const topRows = sortedByLatestCost.slice(0, SERVICE_COST_CHART_TOP_N);
                    const serviceCostChartRows: GroupedBarRow[] = topRows.map((row) => ({
                      group: String(row.activity),
                      values: selectedPeriods.map((p) => ({ x: p, y: Number(row[`${p}_cost`] ?? 0) })),
                      total: selectedPeriods.reduce((s, p) => s + Number(row[`${p}_cost`] ?? 0), 0),
                    }));
                    const cols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'activity', header: 'Activity', cell: ({ row, getValue }: { row: { original: Record<string, unknown> }; getValue: () => unknown }) => {
                        if ((row.original as { isTotal?: boolean }).isTotal === true) return <strong>Total</strong>;
                        const label = String(getValue() ?? '');
                        return (
                          <button type="button" style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, fontSize: 'inherit', textAlign: 'left', textDecoration: 'underline' }}
                            onClick={() => setCustomerActivityCenterDrill({ customerId: serviceCostDrill!.customerId, activityCode: label })}>
                            {label}
                          </button>
                        );
                      }},
                    ];
                    for (const p of selectedPeriods) {
                      cols.push({ accessorKey: `${p}_hours`, header: `${formatMonthMMYYYY(p)} H`, cell: ({ getValue }: { getValue: () => unknown }) => formatNumber1(Number(getValue() ?? 0)) });
                      cols.push({ accessorKey: `${p}_cost`, header: `${formatMonthMMYYYY(p)} Cost`, cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue() ?? 0)) });
                    }
                    return (
                      <>
                        {serviceCostChartRows.length > 0 && (
                          <div className="drill-chart" style={{ marginBottom: 12 }}>
                            <GroupedBarRows rows={serviceCostChartRows} formatPeriod={(x) => formatMonthMMYYYY(x)} barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')} barLabelFormatter={(y) => formatMoney(y)} totalFormatter={formatMoney} width={320} labelWidth={120} monthTotals={serviceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => ({ period: periodNo, total: totalCost }))} labelColumnTitle="Activity"
                              onRowClick={({ label }) => setCustomerActivityCenterDrill({ customerId: serviceCostDrill!.customerId, activityCode: label })} />
                          </div>
                        )}
                        <DataTable data={rowsWithTotal} columns={cols} searchable={false} pageSize={10} sortable={false} />
                      </>
                    );
                  })()}
                  {!serviceCostDrillLoading && serviceCostDrillRows.length === 0 && serviceCostDrillPeriodTotals.length === 0 && (
                    <p className="trend-panel-message">No Service Cost detail for this customer.</p>
                  )}
                </div>
              </div>
            )}

            {/* Level 2: Compare Service Cost drill */}
            {compareServiceCostDrill && (
  <div
    ref={level2Ref}
    className={`drill-panel drilldown-rail-column level-2 ${activeLevel === 2 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Service Cost by Activity — {compareSelected.map((i) => i.label).join(' vs ')}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setCompareServiceCostDrill(false)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {compareServiceCostLoading && <p className="trend-panel-message">Loading…</p>}
                  {!compareServiceCostLoading && compareServiceCostRows.length > 0 && (() => {
                    const itemMonthTotals = compareSelected.map((_item, idx) => ({
                      period: idx,
                      total: compareServiceCostRows.reduce((s, r) => s + (r.values[idx]?.y ?? 0), 0),
                    }));
                    return (
                      <div className="drill-chart">
                        <GroupedBarRows
                          rows={compareServiceCostRows}
                          formatPeriod={(x) => compareSelected[Number(x)]?.label ?? String(x)}
                          barColor={(y) => (y < 0 ? '#C62828' : '#1565C0')}
                          barLabelFormatter={(y) => formatMoney(y)}
                          totalFormatter={formatMoney}
                          labelWidth={160}
                          monthTotals={itemMonthTotals}
                          labelColumnTitle="Activity"
                        />
                      </div>
                    );
                  })()}
                  {!compareServiceCostLoading && compareServiceCostRows.length === 0 && (
                    <p className="trend-panel-message">No service cost activity data found for the selected items.</p>
                  )}
                </div>
              </div>
            )}

            {/* Level 3: SAC Service Cost → Activities */}
            {sacServiceCostDrill != null && (
  <div
    ref={level3Ref}
    className={`drill-panel drilldown-rail-column level-3 ${activeLevel === 3 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Service Cost Activities — {sacServiceCostDrill.sacKey}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setSacServiceCostDrill(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {sacServiceCostDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!sacServiceCostDrillLoading && sacServiceCostDrillPeriodTotals.length > 0 && (
                    <p style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
                      Total by period: {sacServiceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => `${formatMonthMMYYYY(periodNo)}: ${formatMoney(totalCost)}`).join(' · ')}
                    </p>
                  )}
                  {!sacServiceCostDrillLoading && sacServiceCostDrillRows.length > 0 && (() => {
                    const actRows = sacServiceCostDrillRows;
                    const totalRow: Record<string, string | number> = { activity: 'Total' };
                    (totalRow as Record<string, unknown>)['isTotal'] = true;
                    for (const p of selectedPeriods) {
                      totalRow[`${p}_hours`] = actRows.reduce((s, r) => s + Number(r[`${p}_hours`] ?? 0), 0);
                      totalRow[`${p}_cost`] = actRows.reduce((s, r) => s + Number(r[`${p}_cost`] ?? 0), 0);
                    }
                    const rowsWithTotal = [...actRows, totalRow];
                    const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
                    const topRows = [...actRows].sort((a, b) => Number(b[`${lastPeriod}_cost`] ?? 0) - Number(a[`${lastPeriod}_cost`] ?? 0)).slice(0, SERVICE_COST_CHART_TOP_N);
                    const chartRows: GroupedBarRow[] = topRows.map((row) => ({
                      group: String(row.activity),
                      values: selectedPeriods.map((p) => ({ x: p, y: Number(row[`${p}_cost`] ?? 0) })),
                      total: selectedPeriods.reduce((s, p) => s + Number(row[`${p}_cost`] ?? 0), 0),
                    }));
                    const cols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'activity', header: 'Activity', cell: ({ row, getValue }: { row: { original: Record<string, unknown> }; getValue: () => unknown }) => (row.original as { isTotal?: boolean }).isTotal === true ? <strong>Total</strong> : String(getValue() ?? '') },
                    ];
                    for (const p of selectedPeriods) {
                      cols.push({ accessorKey: `${p}_hours`, header: `${formatMonthMMYYYY(p)} Hrs`, cell: ({ getValue }: { getValue: () => unknown }) => formatNumber1(Number(getValue() ?? 0)) });
                      cols.push({ accessorKey: `${p}_cost`, header: `${formatMonthMMYYYY(p)} Cost`, cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue() ?? 0)) });
                    }
                    return (
                      <>
                        {chartRows.length > 0 && (
                          <div className="drill-chart" style={{ marginBottom: 12 }}>
                            <GroupedBarRows
                              rows={chartRows}
                              formatPeriod={(x) => formatMonthMMYYYY(x)}
                              barColor={(y) => (y < 0 ? '#C62828' : '#1565C0')}
                              barLabelFormatter={(y) => formatMoney(y)}
                              totalFormatter={formatMoney}
                              labelWidth={140}
                              monthTotals={sacServiceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => ({ period: periodNo, total: totalCost }))}
                              labelColumnTitle="Activity"
                            />
                          </div>
                        )}
                        <DataTable data={rowsWithTotal} columns={cols} searchable={false} pageSize={10} sortable={false} />
                      </>
                    );
                  })()}
                  {!sacServiceCostDrillLoading && sacServiceCostDrillRows.length === 0 && (
                    <p className="trend-panel-message">No service cost activity data found for this activity center.</p>
                  )}
                </div>
              </div>
            )}

            {/* Level 3: Product Service Cost Breakdown */}
            {productServiceCostDrill != null && (
  <div
    ref={level3Ref}
    className={`drill-panel drilldown-rail-column level-3 ${activeLevel === 3 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Service Cost Breakdown — {productServiceCostDrill.productName}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setProductServiceCostDrill(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {productServiceCostDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!productServiceCostDrillLoading && productServiceCostDrillPeriodTotals.length > 0 && (
                    <p style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
                      Total by period: {productServiceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => `${formatMonthMMYYYY(periodNo)}: ${formatMoney(totalCost)}`).join(' · ')}
                    </p>
                  )}
                  {!productServiceCostDrillLoading && productServiceCostDrillRows.length > 0 && (() => {
                    const activityRows = productServiceCostDrillRows;
                    const totalRow: Record<string, string | number> = { activity: 'Total' };
                    (totalRow as Record<string, unknown>)['isTotal'] = true;
                    for (const p of selectedPeriods) {
                      totalRow[`${p}_hours`] = activityRows.reduce((s, r) => s + Number(r[`${p}_hours`] ?? 0), 0);
                      totalRow[`${p}_cost`] = activityRows.reduce((s, r) => s + Number(r[`${p}_cost`] ?? 0), 0);
                    }
                    const rowsWithTotal = [...activityRows, totalRow];
                    const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
                    const sortedByLatestCost = [...activityRows].sort((a, b) => Number(b[`${lastPeriod}_cost`] ?? 0) - Number(a[`${lastPeriod}_cost`] ?? 0));
                    const topRows = sortedByLatestCost.slice(0, SERVICE_COST_CHART_TOP_N);
                    const chartRows: GroupedBarRow[] = topRows.map((row) => ({
                      group: String(row.activity),
                      values: selectedPeriods.map((p) => ({ x: p, y: Number(row[`${p}_cost`] ?? 0) })),
                      total: selectedPeriods.reduce((s, p) => s + Number(row[`${p}_cost`] ?? 0), 0),
                    }));
                    const cols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'activity', header: 'Employee / Activity Center', cell: ({ row, getValue }: { row: { original: Record<string, unknown> }; getValue: () => unknown }) => {
                        if ((row.original as { isTotal?: boolean }).isTotal === true) return <strong>Total</strong>;
                        const label = String(getValue() ?? '');
                        return (
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, fontSize: 'inherit', textAlign: 'left', textDecoration: 'underline' }}
                            onClick={() => setProductServiceCostCenterDrill({ productName: productServiceCostDrill!.productName, centerKey: label })}
                          >
                            {label}
                          </button>
                        );
                      }},
                    ];
                    for (const p of selectedPeriods) {
                      cols.push({ accessorKey: `${p}_hours`, header: `${formatMonthMMYYYY(p)} Hrs`, cell: ({ getValue }: { getValue: () => unknown }) => formatNumber1(Number(getValue() ?? 0)) });
                      cols.push({ accessorKey: `${p}_cost`, header: `${formatMonthMMYYYY(p)} Cost`, cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue() ?? 0)) });
                    }
                    return (
                      <>
                        {chartRows.length > 0 && (
                          <div className="drill-chart" style={{ marginBottom: 12 }}>
                            <GroupedBarRows
                              rows={chartRows}
                              formatPeriod={(x) => formatMonthMMYYYY(x)}
                              barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                              barLabelFormatter={(y) => formatMoney(y)}
                              totalFormatter={formatMoney}
                              labelWidth={120}
                              monthTotals={productServiceCostDrillPeriodTotals.map(({ periodNo, totalCost }) => ({ period: periodNo, total: totalCost }))}
                              labelColumnTitle="Activity"
                              onRowClick={({ label }) => setProductServiceCostCenterDrill({ productName: productServiceCostDrill!.productName, centerKey: label })}
                            />
                          </div>
                        )}
                        <DataTable data={rowsWithTotal} columns={cols} searchable={false} pageSize={10} sortable={false} />
                      </>
                    );
                  })()}
                  {!productServiceCostDrillLoading && productServiceCostDrillRows.length === 0 && productServiceCostDrillPeriodTotals.length === 0 && (
                    <p className="trend-panel-message">No Service Cost activity data found for this product. Check that CustomerServiceCost has matching ServiceProduct entries.</p>
                  )}
                </div>
              </div>
            )}
            {/* Level 4: Activity Centers for one Activity (customer path) */}
            {customerActivityCenterDrill != null && (
  <div
    ref={level4Ref}
    className={`drill-panel drilldown-rail-column level-4 ${activeLevel === 4 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Activity Centers — {customerActivityCenterDrill.activityCode}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setCustomerActivityCenterDrill(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {customerActivityCenterDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!customerActivityCenterDrillLoading && customerActivityCenterDrillPeriodTotals.length > 0 && (
                    <p style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
                      Total by period: {customerActivityCenterDrillPeriodTotals.map(({ periodNo, totalCost }) => `${formatMonthMMYYYY(periodNo)}: ${formatMoney(totalCost)}`).join(' · ')}
                    </p>
                  )}
                  {!customerActivityCenterDrillLoading && customerActivityCenterDrillRows.length > 0 && (() => {
                    const actRows = customerActivityCenterDrillRows;
                    const totalRow: Record<string, string | number> = { activity: 'Total' };
                    (totalRow as Record<string, unknown>)['isTotal'] = true;
                    for (const p of selectedPeriods) {
                      totalRow[`${p}_hours`] = actRows.reduce((s, r) => s + Number(r[`${p}_hours`] ?? 0), 0);
                      totalRow[`${p}_cost`] = actRows.reduce((s, r) => s + Number(r[`${p}_cost`] ?? 0), 0);
                    }
                    const rowsWithTotal = [...actRows, totalRow];
                    const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
                    const topRows = [...actRows].sort((a, b) => Number(b[`${lastPeriod}_cost`] ?? 0) - Number(a[`${lastPeriod}_cost`] ?? 0)).slice(0, SERVICE_COST_CHART_TOP_N);
                    const chartRows: GroupedBarRow[] = topRows.map((row) => ({
                      group: String(row.activity),
                      values: selectedPeriods.map((p) => ({ x: p, y: Number(row[`${p}_cost`] ?? 0) })),
                      total: selectedPeriods.reduce((s, p) => s + Number(row[`${p}_cost`] ?? 0), 0),
                    }));
                    const cols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'activity', header: 'Activity Center', cell: ({ row, getValue }: { row: { original: Record<string, unknown> }; getValue: () => unknown }) => (row.original as { isTotal?: boolean }).isTotal === true ? <strong>Total</strong> : String(getValue() ?? '') },
                    ];
                    for (const p of selectedPeriods) {
                      cols.push({ accessorKey: `${p}_hours`, header: `${formatMonthMMYYYY(p)} Hrs`, cell: ({ getValue }: { getValue: () => unknown }) => formatNumber1(Number(getValue() ?? 0)) });
                      cols.push({ accessorKey: `${p}_cost`, header: `${formatMonthMMYYYY(p)} Cost`, cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue() ?? 0)) });
                    }
                    return (
                      <>
                        {chartRows.length > 0 && (
                          <div className="drill-chart" style={{ marginBottom: 12 }}>
                            <GroupedBarRows
                              rows={chartRows}
                              formatPeriod={(x) => formatMonthMMYYYY(x)}
                              barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                              barLabelFormatter={(y) => formatMoney(y)}
                              totalFormatter={formatMoney}
                              labelWidth={140}
                              monthTotals={customerActivityCenterDrillPeriodTotals.map(({ periodNo, totalCost }) => ({ period: periodNo, total: totalCost }))}
                              labelColumnTitle="Activity Center"
                            />
                          </div>
                        )}
                        <DataTable data={rowsWithTotal} columns={cols} searchable={false} pageSize={10} sortable={false} />
                      </>
                    );
                  })()}
                  {!customerActivityCenterDrillLoading && customerActivityCenterDrillRows.length === 0 && (
                    <p className="trend-panel-message">No activity center data found for this activity.</p>
                  )}
                </div>
              </div>
            )}

            {/* Level 4: Activities within one Activity Center */}
            {productServiceCostCenterDrill != null && (
  <div
    ref={level4Ref}
    className={`drill-panel drilldown-rail-column level-4 ${activeLevel === 4 ? 'active' : 'inactive'} enter`}
  >
                <div className="drill-panel-header drilldown-rail-column-header">
                  <span className="drill-panel-title">Activities — {productServiceCostCenterDrill.centerKey}</span>
                  <button type="button" className="drilldown-rail-close" onClick={() => setProductServiceCostCenterDrill(null)}>Close</button>
                </div>
                <div className="drill-panel-body drilldown-rail-column-body">
                  {productServiceCostCenterDrillLoading && <p className="trend-panel-message">Loading…</p>}
                  {!productServiceCostCenterDrillLoading && productServiceCostCenterDrillPeriodTotals.length > 0 && (
                    <p style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
                      Total by period: {productServiceCostCenterDrillPeriodTotals.map(({ periodNo, totalCost }) => `${formatMonthMMYYYY(periodNo)}: ${formatMoney(totalCost)}`).join(' · ')}
                    </p>
                  )}
                  {!productServiceCostCenterDrillLoading && productServiceCostCenterDrillRows.length > 0 && (() => {
                    const actRows = productServiceCostCenterDrillRows;
                    const totalRow: Record<string, string | number> = { activity: 'Total' };
                    (totalRow as Record<string, unknown>)['isTotal'] = true;
                    for (const p of selectedPeriods) {
                      totalRow[`${p}_hours`] = actRows.reduce((s, r) => s + Number(r[`${p}_hours`] ?? 0), 0);
                      totalRow[`${p}_cost`] = actRows.reduce((s, r) => s + Number(r[`${p}_cost`] ?? 0), 0);
                    }
                    const rowsWithTotal = [...actRows, totalRow];
                    const lastPeriod = selectedPeriods[selectedPeriods.length - 1];
                    const topRows = [...actRows].sort((a, b) => Number(b[`${lastPeriod}_cost`] ?? 0) - Number(a[`${lastPeriod}_cost`] ?? 0)).slice(0, SERVICE_COST_CHART_TOP_N);
                    const chartRows: GroupedBarRow[] = topRows.map((row) => ({
                      group: String(row.activity),
                      values: selectedPeriods.map((p) => ({ x: p, y: Number(row[`${p}_cost`] ?? 0) })),
                      total: selectedPeriods.reduce((s, p) => s + Number(row[`${p}_cost`] ?? 0), 0),
                    }));
                    const cols: ColumnDef<Record<string, string | number>, unknown>[] = [
                      { accessorKey: 'activity', header: 'Activity', cell: ({ row, getValue }: { row: { original: Record<string, unknown> }; getValue: () => unknown }) => (row.original as { isTotal?: boolean }).isTotal === true ? <strong>Total</strong> : String(getValue() ?? '') },
                    ];
                    for (const p of selectedPeriods) {
                      cols.push({ accessorKey: `${p}_hours`, header: `${formatMonthMMYYYY(p)} Hrs`, cell: ({ getValue }: { getValue: () => unknown }) => formatNumber1(Number(getValue() ?? 0)) });
                      cols.push({ accessorKey: `${p}_cost`, header: `${formatMonthMMYYYY(p)} Cost`, cell: ({ getValue }: { getValue: () => unknown }) => formatMoney(Number(getValue() ?? 0)) });
                    }
                    return (
                      <>
                        {chartRows.length > 0 && (
                          <div className="drill-chart" style={{ marginBottom: 12 }}>
                            <GroupedBarRows
                              rows={chartRows}
                              formatPeriod={(x) => formatMonthMMYYYY(x)}
                              barColor={() => '#1565C0'}
                              barLabelFormatter={(y) => formatMoney(y)}
                              totalFormatter={formatMoney}
                              labelWidth={140}
                              monthTotals={productServiceCostCenterDrillPeriodTotals.map(({ periodNo, totalCost }) => ({ period: periodNo, total: totalCost }))}
                              labelColumnTitle="Activity"
                            />
                          </div>
                        )}
                        <DataTable data={rowsWithTotal} columns={cols} searchable={false} pageSize={10} sortable={false} />
                      </>
                    );
                  })()}
                  {!productServiceCostCenterDrillLoading && productServiceCostCenterDrillRows.length === 0 && (
                    <p className="trend-panel-message">No activity data found for this activity center.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
      </div>

      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

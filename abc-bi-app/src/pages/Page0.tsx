import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRefreshContext } from '../contexts/RefreshContext';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { SimpleChart, formatMonthMMYYYY } from '../components/SimpleChart';
import { GroupedBarRows } from '../components/GroupedBarRows';
import type { GroupedBarRow } from '../components/GroupedBarRows';
import { getTableData, listPeriods, getTable } from '../dataApi';
import { formatCurrency, formatPercent } from '../utils/format';
import { toNumber } from '../normalize';
import type {
  CustomerProductProfitRow,
  CustomerProfitResultRow,
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
    return { label: `${formatCurrency(lo)} ~ ${formatCurrency(hi)}`, count: 0, sumProfit: 0 };
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

/** Build first-layer By Customer grouped rows from CustomerProfitResult per period. Same source as Total Profitability. */
function buildDrilldownByCustomer(
  resultsByPeriod: CustomerProfitResultRow[][],
  selectedPeriods: number[],
  topN: number
): { rows: GroupedBarRow[]; monthTotals: { period: number; total: number }[] } {
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
  customerTotals.sort((a, b) => b.lastPeriodProfit - a.lastPeriodProfit);
  const topKeys = new Set(customerTotals.slice(0, topN).map((x) => x.key));
  const rows: GroupedBarRow[] = [];
  for (const { key } of customerTotals.slice(0, topN)) {
    const values = selectedPeriods.map((p) => ({
      x: p,
      y: byPeriod.get(p)?.get(key) ?? 0,
    }));
    rows.push({
      group: key,
      values,
      total: values.reduce((s, v) => s + v.y, 0),
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
  const [drilldownMode, setDrilldownMode] = useState<'ranked' | 'hist' | 'product' | 'salesActivityCenter' | 'customer'>('ranked');
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const [showAllRanked, setShowAllRanked] = useState(false);
  const [drilldownRows, setDrilldownRows] = useState<CustomerProfitResultRow[]>([]);
  const [histBins, setHistBins] = useState<HistBin[]>([]);
  const [productRows, setProductRows] = useState<{ productName: string; profit: number }[]>([]);
  const [productDataAvailable, setProductDataAvailable] = useState(false);
  const [groupedProductRows, setGroupedProductRows] = useState<GroupedBarRow[]>([]);
  const [groupedSalesActivityCenterRows, setGroupedSalesActivityCenterRows] = useState<GroupedBarRow[]>([]);
  const [salesActivityCenterMonthTotals, setSalesActivityCenterMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [salesActivityCenterDataAvailable, setSalesActivityCenterDataAvailable] = useState(false);
  const [groupedCustomerRows, setGroupedCustomerRows] = useState<GroupedBarRow[]>([]);
  const [customerMonthTotals, setCustomerMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [drilldown2, setDrilldown2] = useState<Drilldown2State>(null);
  const [drilldown2Mode, setDrilldown2Mode] = useState<'product' | 'customer'>('product');
  const [drilldown2ProductRows, setDrilldown2ProductRows] = useState<GroupedBarRow[]>([]);
  const [drilldown2CustomerRows, setDrilldown2CustomerRows] = useState<GroupedBarRow[]>([]);
  const [drilldown2ProductMonthTotals, setDrilldown2ProductMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [drilldown2CustomerMonthTotals, setDrilldown2CustomerMonthTotals] = useState<{ period: number; total: number }[]>([]);
  const [drilldown2Total, setDrilldown2Total] = useState<number | null>(null);
  const [drilldown2Loading, setDrilldown2Loading] = useState(false);
  const [drilldown2Message, setDrilldown2Message] = useState<string | null>(null);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [errorDrilldown, setErrorDrilldown] = useState<string | null>(null);

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
      })
      .catch(() => {
        if (!cancelled) setGroupedProductRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriods]);

  useEffect(() => {
    if (selectedPeriods.length === 0) {
      setGroupedSalesActivityCenterRows([]);
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
      })
      .catch(() => {
        if (!cancelled) {
          setGroupedSalesActivityCenterRows([]);
          setSalesActivityCenterMonthTotals([]);
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
      return;
    }
    let cancelled = false;
    Promise.all(selectedPeriods.map((p) => getTable<CustomerProfitResultRow>(p, 'CustomerProfitResult')))
      .then((results) => {
        if (cancelled) return;
        const { rows, monthTotals } = buildDrilldownByCustomer(
          results,
          selectedPeriods,
          DRILLDOWN_TOP_CUSTOMERS_LAYER1
        );
        setGroupedCustomerRows(rows);
        setCustomerMonthTotals(monthTotals);
      })
      .catch(() => {
        if (!cancelled) {
          setGroupedCustomerRows([]);
          setCustomerMonthTotals([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriods]);

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
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'SalesProfit',
      header: 'SalesProfit',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'ServiceCost',
      header: 'ServiceCost',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'CustomerProfit',
      header: 'CustomerProfit',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={v >= 0 ? 'profit-positive' : 'profit-negative'}>{formatCurrency(v ?? 0)}</span>;
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

  const breadcrumb = [{ label: 'Customer Overview', path: `/page0?periodNo=${periodNo}` }];

  const chartFormatCurrency = (y: number) => formatCurrency(y);
  const chartFormatCount = (y: number) => String(Math.round(y));

  return (
    <>
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
                barLabelFormatter={(v) => v.toLocaleString('en-US')}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatCurrency}
                width={340}
                height={200}
                onBarClick={(d) => {
                const p = Number(d.x);
                setSelectedPeriodNo(p);
                const periodList = aggregates.map((a) => a.periodNo);
                setSelectedPeriods(getPeriodRange(periodList, p));
              }}
              />
            </div>
            <div className="dashboard-chart">
              <h3 className="dashboard-chart-title">Total Revenue</h3>
              <SimpleChart
                data={aggregates.map((a) => ({ x: a.periodNo, y: a.totalRevenue }))}
                type="bar"
                color="#1565C0"
                barLabelFormatter={(v) => v.toLocaleString('en-US')}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatCurrency}
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
                barLabelFormatter={(v) => v.toLocaleString('en-US')}
                xLabelFormatter={(x) => formatMonthMMYYYY(x)}
                xLabel="Period"
                yLabel="Value"
                formatX={(x) => String(x)}
                formatY={chartFormatCurrency}
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
        <section className="trend-panel drilldown-panel">
          <div className="drilldown-header-row">
            <h3 className="drilldown-title">
              {selectedPeriods.length === 0
                ? `Drill-down: Period ${selectedPeriodNo}`
                : selectedPeriods.length === 1
                  ? `Drill-down: Period ${selectedPeriods[0]}`
                  : `Drill-down: Period ${selectedPeriods[0]}–${selectedPeriods[selectedPeriods.length - 1]}`}
            </h3>
            <button
              type="button"
              className="drilldown-close btn"
              onClick={() => {
                setSelectedPeriodNo(null);
                setSelectedPeriods([]);
              }}
            >
              Close
            </button>
          </div>
          <div className="drilldown-tabs">
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
          </div>

          {loadingDrilldown && <p className="trend-panel-message">Loading drill-down…</p>}
          {errorDrilldown && <p className="trend-panel-message">{errorDrilldown}</p>}

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'ranked' && (
            <>
              {drilldownRows.length > 0 && (
                <>
                  <div className="drilldown-summary">
                    <span>Customers: {drilldownRows.length}</span>
                    <span>Total Profit: {formatCurrency(drilldownRows.reduce((s, r) => s + toNumber(r.CustomerProfit, 0), 0))}</span>
                    <span>Avg Profit: {formatCurrency(drilldownRows.length ? drilldownRows.reduce((s, r) => s + toNumber(r.CustomerProfit, 0), 0) / drilldownRows.length : 0)}</span>
                    <span>Median: {formatCurrency(median(drilldownRows.map((r) => toNumber(r.CustomerProfit, 0)).sort((a, b) => a - b)))}</span>
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
                          <th>#</th>
                          <th>CustomerID</th>
                          <th>Customer</th>
                          <th>CustomerProfit</th>
                          <th>Revenue (Price)</th>
                          <th>ServiceCost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllRanked ? drilldownRows : drilldownRows.slice(0, topN)).map((r, i) => (
                          <tr key={`${r.customerId}-${i}`}>
                            <td>{i + 1}</td>
                            <td>{String(r.CustomerID ?? r.customerId ?? '')}</td>
                            <td>{String(r.Customer ?? '')}</td>
                            <td className={toNumber(r.CustomerProfit, 0) >= 0 ? 'profit-positive' : 'profit-negative'}>
                              {formatCurrency(toNumber(r.CustomerProfit, 0))}
                            </td>
                            <td>{formatCurrency(toNumber(r.Price, 0))}</td>
                            <td>{formatCurrency(toNumber(r.ServiceCost, 0))}</td>
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

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'customer' && (
            <>
              {groupedCustomerRows.length > 0 ? (
                <GroupedBarRows
                  rows={groupedCustomerRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => y.toLocaleString('en-US')}
                  width={560}
                  labelWidth={140}
                  monthTotals={customerMonthTotals}
                  labelColumnTitle="Customer"
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
                  barLabelFormatter={(y) => y.toLocaleString('en-US')}
                  width={560}
                  labelWidth={140}
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
                  barLabelFormatter={(y) => y.toLocaleString('en-US')}
                  width={560}
                  labelWidth={140}
                  monthTotals={salesActivityCenterMonthTotals}
                  onBarClick={({ groupLabel, period }) => {
                    setDrilldown2Mode('product');
                    setDrilldown2({
                      salesActivityCenterKey: groupLabel,
                      clickedPeriodNo: period,
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

          {drilldown2 != null && (
            <div className="drilldown-2-panel" style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div className="drilldown-2-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h4 className="drilldown-2-title" style={{ margin: 0, fontSize: 15 }}>
                    Drill-down 2: {drilldown2.salesActivityCenterKey} → {drilldown2Mode === 'product' ? 'By Product' : 'By Customer'}
                  </h4>
                  <p className="drilldown-2-periods" style={{ margin: '4px 0 0', fontSize: 12, color: '#555' }}>
                    Period: {drilldown2.periods.length === 1
                      ? String(drilldown2.periods[0])
                      : `${drilldown2.periods[0]}–${drilldown2.periods[drilldown2.periods.length - 1]}`}
                    {drilldown2.clickedPeriodNo !== undefined && (
                      <span style={{ marginLeft: 8 }}> (clicked month: {formatMonthMMYYYY(drilldown2.clickedPeriodNo)})</span>
                    )}
                    {drilldown2Total != null && (
                      <span style={{ marginLeft: 8 }}> · Total: {formatCurrency(drilldown2Total)}</span>
                    )}
                  </p>
                  <div className="drilldown-2-mode-switch" style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={drilldown2Mode === 'product' ? 'btn btn-primary' : 'btn'}
                      onClick={() => setDrilldown2Mode('product')}
                    >
                      Product
                    </button>
                    <button
                      type="button"
                      className={drilldown2Mode === 'customer' ? 'btn btn-primary' : 'btn'}
                      onClick={() => setDrilldown2Mode('customer')}
                    >
                      Customer
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDrilldown2(null)}
                >
                  Close Drill-down 2
                </button>
              </div>
              {drilldown2Loading && <p className="trend-panel-message">Loading…</p>}
              {!drilldown2Loading && drilldown2Message != null && (
                <p className="trend-panel-message">{drilldown2Message}</p>
              )}
              {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'product' && drilldown2ProductRows.length > 0 && (
                <GroupedBarRows
                  rows={drilldown2ProductRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => y.toLocaleString('en-US')}
                  width={560}
                  labelWidth={140}
                  monthTotals={drilldown2ProductMonthTotals}
                  labelColumnTitle="Product"
                />
              )}
              {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'customer' && drilldown2CustomerRows.length > 0 && (
                <GroupedBarRows
                  rows={drilldown2CustomerRows}
                  formatPeriod={(x) => formatMonthMMYYYY(x)}
                  barColor={(y) => (y < 0 ? '#C62828' : '#2E7D32')}
                  barLabelFormatter={(y) => y.toLocaleString('en-US')}
                  width={560}
                  labelWidth={140}
                  monthTotals={drilldown2CustomerMonthTotals}
                  labelColumnTitle="Customer"
                />
              )}
              {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'product' && drilldown2ProductRows.length === 0 && drilldown2 != null && (
                <p className="trend-panel-message">No product data for this Sales Activity Center in the selected periods.</p>
              )}
              {!drilldown2Loading && drilldown2Message == null && drilldown2Mode === 'customer' && drilldown2CustomerRows.length === 0 && drilldown2 != null && (
                <p className="trend-panel-message">No customer data for this Sales Activity Center in the selected periods.</p>
              )}
            </div>
          )}
        </section>
      )}

      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

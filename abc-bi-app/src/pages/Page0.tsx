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
import type { CustomerProfitResultRow, IncomeStatmentRow, ProductProfitResultRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

const DRILLDOWN_BINS = 10;
const DEFAULT_TOP_N = 20;
const DRILLDOWN_TOP_PRODUCTS = 10;

/** Get up to 3 consecutive periods centered on clicked (prev, current, next). */
function getPeriodRange(periodNos: number[], clicked: number): number[] {
  const sorted = [...periodNos].sort((a, b) => a - b);
  const idx = sorted.indexOf(clicked);
  if (idx === -1) return [clicked];
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
  return sorted.slice(start, end + 1);
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
  const [drilldownMode, setDrilldownMode] = useState<'ranked' | 'hist' | 'product' | 'employee'>('ranked');
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const [showAllRanked, setShowAllRanked] = useState(false);
  const [drilldownRows, setDrilldownRows] = useState<CustomerProfitResultRow[]>([]);
  const [histBins, setHistBins] = useState<HistBin[]>([]);
  const [productRows, setProductRows] = useState<{ productName: string; profit: number }[]>([]);
  const [productDataAvailable, setProductDataAvailable] = useState(false);
  const [groupedProductRows, setGroupedProductRows] = useState<GroupedBarRow[]>([]);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [errorDrilldown, setErrorDrilldown] = useState<string | null>(null);
  const employeeDataAvailable = false;

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
        {!dashboardLoading && !dashboardError && aggregates.length < 2 && (
          <p className="trend-panel-message">Upload 2+ periods to see trends.</p>
        )}
        {!dashboardLoading && !dashboardError && aggregates.length >= 2 && (
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
              className={`drilldown-tab ${drilldownMode === 'product' ? 'active' : ''} ${!productDataAvailable ? 'disabled' : ''}`}
              onClick={() => productDataAvailable && setDrilldownMode('product')}
              disabled={!productDataAvailable}
            >
              By Product
            </button>
            <button
              type="button"
              className={`drilldown-tab ${drilldownMode === 'employee' ? 'active' : ''} disabled`}
              disabled
              title="Employee breakdown requires employee fields/table (not found in current dataset)."
            >
              By Service Employee
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

          {!loadingDrilldown && !errorDrilldown && drilldownMode === 'employee' && (
            <p className="trend-panel-message">
              Employee breakdown requires employee fields/table (not found in current dataset).
            </p>
          )}
        </section>
      )}

      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

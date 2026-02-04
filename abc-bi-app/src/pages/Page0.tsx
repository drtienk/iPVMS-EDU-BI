import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { SimpleChart } from '../components/SimpleChart';
import { getTableData, listPeriods, getTable } from '../dataApi';
import { formatCurrency, formatPercent } from '../utils/format';
import type { CustomerProfitResultRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export type TrendMetric = 'customerCount' | 'totalCustomerProfit' | 'totalServiceCost' | 'avgProfitRatio';

export interface PeriodAggregate {
  periodNo: number;
  customerCount: number;
  totalCustomerProfit: number;
  totalServiceCost: number;
  avgProfitRatio: number;
}

function computePeriodAggregate(periodNo: number, rows: CustomerProfitResultRow[]): PeriodAggregate {
  const customerIds = new Set(rows.map((r) => String(r.customerId ?? '')).filter(Boolean));
  const totalCustomerProfit = rows.reduce((s, r) => s + (Number(r.CustomerProfit) || 0), 0);
  const totalServiceCost = rows.reduce((s, r) => s + (Number(r.ServiceCost) ?? 0), 0);
  const ratios = rows.map((r) => r.CustomerProfitRatio).filter((v): v is number => v != null && !Number.isNaN(v));
  const avgProfitRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return {
    periodNo,
    customerCount: customerIds.size,
    totalCustomerProfit,
    totalServiceCost,
    avgProfitRatio,
  };
}

export function Page0() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const periodNoStr = searchParams.get('periodNo');
  const periodNo = periodNoStr ? Number(periodNoStr) : NaN;
  const [data, setData] = useState<CustomerProfitResultRow[]>([]);
  const [periodAggregates, setPeriodAggregates] = useState<PeriodAggregate[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<TrendMetric>('customerCount');

  useEffect(() => {
    if (isNaN(periodNo)) {
      setData([]);
      return;
    }
    getTableData<CustomerProfitResultRow>(periodNo, 'CustomerProfitResult').then(setData);
  }, [periodNo]);

  useEffect(() => {
    setTrendLoading(true);
    setTrendError(null);
    listPeriods()
      .then(async (periodNos) => {
        const aggregates: PeriodAggregate[] = [];
        for (const no of periodNos) {
          try {
            const rows = await getTable<CustomerProfitResultRow>(no, 'CustomerProfitResult');
            if (rows.length > 0) {
              aggregates.push(computePeriodAggregate(no, rows));
            }
          } catch {
            // Skip period if table missing or invalid
          }
        }
        setPeriodAggregates(aggregates);
      })
      .catch(() => setTrendError('No data'))
      .finally(() => setTrendLoading(false));
  }, []);

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

  const breadcrumb = [{ label: '顧客總覽', path: `/page0?periodNo=${periodNo}` }];

  const chartData = periodAggregates.map((a) => ({
    x: a.periodNo,
    y:
      selectedMetric === 'customerCount'
        ? a.customerCount
        : selectedMetric === 'totalCustomerProfit'
          ? a.totalCustomerProfit
          : selectedMetric === 'totalServiceCost'
            ? a.totalServiceCost
            : a.avgProfitRatio,
  }));

  const isLine = selectedMetric === 'customerCount' || selectedMetric === 'avgProfitRatio';
  const metricLabels: Record<TrendMetric, string> = {
    customerCount: 'Customer Count',
    totalCustomerProfit: 'Total Customer Profit',
    totalServiceCost: 'Total Service Cost',
    avgProfitRatio: 'Average Profit Ratio',
  };
  const formatY =
    selectedMetric === 'avgProfitRatio'
      ? (y: number) => (y * 100).toFixed(1) + '%'
      : selectedMetric === 'customerCount'
        ? (y: number) => String(Math.round(y))
        : (y: number) => formatCurrency(y);

  return (
    <>
      <section className="trend-panel">
        <h2 className="trend-panel-title">Customer Overview Trend</h2>
        {trendLoading && <p className="trend-panel-message">Loading…</p>}
        {!trendLoading && trendError && <p className="trend-panel-message">No data</p>}
        {!trendLoading && !trendError && periodAggregates.length < 2 && (
          <p className="trend-panel-message">Upload 2+ periods to see trends.</p>
        )}
        {!trendLoading && !trendError && periodAggregates.length >= 2 && (
          <>
            <div className="trend-panel-controls">
              <label>
                Metric:{' '}
                <select
                  value={selectedMetric}
                  onChange={(e) => setSelectedMetric(e.target.value as TrendMetric)}
                  className="trend-metric-select"
                >
                  <option value="customerCount">Customer Count (line)</option>
                  <option value="totalCustomerProfit">Total Customer Profit (bar)</option>
                  <option value="totalServiceCost">Total Service Cost (bar)</option>
                  <option value="avgProfitRatio">Average Profit Ratio (line)</option>
                </select>
              </label>
            </div>
            <SimpleChart
              data={chartData}
              type={isLine ? 'line' : 'bar'}
              xLabel="Period"
              yLabel={metricLabels[selectedMetric]}
              formatX={(x) => String(x)}
              formatY={formatY}
            />
          </>
        )}
      </section>
      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

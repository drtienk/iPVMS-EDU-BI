import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { formatCurrency, formatPercent } from '../utils/format';
import type { CustomerProfitResultRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export function Page0() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const periodNoStr = searchParams.get('periodNo');
  const periodNo = periodNoStr ? Number(periodNoStr) : NaN;
  const [data, setData] = useState<CustomerProfitResultRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo)) {
      setData([]);
      return;
    }
    getTableData<CustomerProfitResultRow>(periodNo, 'CustomerProfitResult').then(setData);
  }, [periodNo]);

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

  const breadcrumb = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
  ];

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

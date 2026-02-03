import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { formatCurrency } from '../utils/format';
import type { CustomerProductProfitRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export function Page1() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const periodNo = Number(searchParams.get('periodNo'));
  const customerId = searchParams.get('customerId') ?? '';
  const company = searchParams.get('company') ?? '';
  const buCode = searchParams.get('buCode') ?? '';
  const [data, setData] = useState<CustomerProductProfitRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo) || !customerId) return;
    getTableData<CustomerProductProfitRow>(periodNo, 'CustomerProductProfit').then((rows) => {
      setData(rows.filter((r) => r.periodNo === periodNo && r.customerId === customerId));
    });
  }, [periodNo, customerId]);

  if (isNaN(periodNo) || !customerId) {
    navigate('/page0');
    return null;
  }

  const columns: ColumnDef<CustomerProductProfitRow, unknown>[] = [
    { accessorKey: 'SalesOrderNo', header: 'SalesOrderNo' },
    { accessorKey: 'Product', header: 'Product' },
    { accessorKey: 'SalesActivityCenter', header: 'SalesActivityCenter' },
    {
      accessorKey: 'Price',
      header: 'Price',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'ServiceCost',
      header: 'ServiceCost',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'NetIncome',
      header: 'NetIncome',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    { accessorKey: 'Quantity', header: 'Quantity' },
    {
      accessorKey: 'NetProfit',
      header: 'NetProfit',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={v >= 0 ? 'profit-positive' : 'profit-negative'}>{formatCurrency(v ?? 0)}</span>;
      },
    },
  ];

  const base = `/page1?periodNo=${periodNo}&customerId=${customerId}&company=${encodeURIComponent(company)}&buCode=${encodeURIComponent(buCode)}`;
  const breadcrumb = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
    { label: `${customerId}`, path: base },
  ];

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <div className="page-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate(`/page2?periodNo=${periodNo}&customerId=${customerId}`)}
        >
          🔍 服務成本分析
        </button>
      </div>
      <DataTable data={data} columns={columns} />
    </>
  );
}

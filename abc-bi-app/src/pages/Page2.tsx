import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRefreshContext } from '../contexts/RefreshContext';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { toNumber } from '../normalize';
import { formatCurrency } from '../utils/format';
import type { CustomerServiceCostRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

interface GroupedRow {
  activityCenterKey: string;
  totalAmount: number;
  count: number;
}

export function Page2() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshToken } = useRefreshContext();
  const periodNo = Number(searchParams.get('periodNo'));
  const customerId = searchParams.get('customerId') ?? '';
  const [data, setData] = useState<GroupedRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo) || !customerId) return;
    getTableData<CustomerServiceCostRow>(periodNo, 'CustomerServiceCost').then((rows) => {
      const filtered = rows.filter((r) => r.periodNo === periodNo && r.customerId === customerId);
      const grouped = filtered.reduce((acc, row) => {
        const key = row.activityCenterKey;
        if (!acc[key]) acc[key] = { activityCenterKey: key, totalAmount: 0, count: 0 };
        acc[key].totalAmount += toNumber(row.Amount, 0);
        acc[key].count += 1;
        return acc;
      }, {} as Record<string, GroupedRow>);
      setData(Object.values(grouped));
    });
  }, [periodNo, customerId, refreshToken]);

  if (isNaN(periodNo) || !customerId) {
    navigate('/page0');
    return null;
  }

  const columns: ColumnDef<GroupedRow, unknown>[] = [
    { accessorKey: 'activityCenterKey', header: 'Activity Center' },
    {
      accessorKey: 'totalAmount',
      header: '總 Amount',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    { accessorKey: 'count', header: '筆數' },
  ];

  const handleRowClick = (row: GroupedRow) => {
    navigate(
      `/page3?periodNo=${periodNo}&customerId=${customerId}&activityCenterKey=${encodeURIComponent(row.activityCenterKey)}`
    );
  };

  const breadcrumb = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
    { label: customerId, path: `/page1?periodNo=${periodNo}&customerId=${customerId}` },
    { label: '服務成本分析', path: `/page2?periodNo=${periodNo}&customerId=${customerId}` },
  ];

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

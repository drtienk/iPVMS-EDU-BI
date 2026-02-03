import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { formatCurrency } from '../utils/format';
import type { ResourceRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export function Page5() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const periodNo = Number(searchParams.get('periodNo'));
  const activityCenterKey = searchParams.get('activityCenterKey') ? decodeURIComponent(searchParams.get('activityCenterKey')!) : '';
  const customerId = searchParams.get('customerId') ?? '';
  const [data, setData] = useState<ResourceRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo) || !activityCenterKey) return;
    getTableData<ResourceRow>(periodNo, 'Resource').then((rows) => {
      setData(rows.filter((r) => r.periodNo === periodNo && r.activityCenterKey === activityCenterKey));
    });
  }, [periodNo, activityCenterKey]);

  if (isNaN(periodNo) || !activityCenterKey) {
    navigate('/page0');
    return null;
  }

  const columns: ColumnDef<ResourceRow, unknown>[] = [
    { accessorKey: 'Resource Code', header: 'Resource Code' },
    { accessorKey: 'Resource - Level 2', header: 'Resource - Level 2' },
    { accessorKey: 'CostType', header: 'CostType' },
    {
      accessorKey: 'Amount',
      header: 'Amount',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    { accessorKey: 'Resource Driver', header: 'Resource Driver' },
    {
      accessorKey: 'ResourceDriverRate',
      header: 'ResourceDriverRate',
      cell: ({ getValue }) => (getValue() as number) ?? 0,
    },
    { accessorKey: 'FromAc', header: '分攤來源作業中心 (FromAc)' },
  ];

  const breadcrumb: { label: string; path: string }[] = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
  ];
  if (customerId) {
    breadcrumb.push({ label: customerId, path: `/page1?periodNo=${periodNo}&customerId=${customerId}` });
    breadcrumb.push({ label: '服務成本分析', path: `/page2?periodNo=${periodNo}&customerId=${customerId}` });
    breadcrumb.push({ label: activityCenterKey, path: `/page3?periodNo=${periodNo}&customerId=${customerId}&activityCenterKey=${encodeURIComponent(activityCenterKey)}` });
  }
  breadcrumb.push({ label: '資源明細', path: '#' });

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} />
    </>
  );
}

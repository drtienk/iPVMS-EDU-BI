import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { extractCode } from '../normalize';
import { formatCurrency } from '../utils/format';
import type { ActivityDriverRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export function Page3() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const periodNo = Number(searchParams.get('periodNo'));
  const customerId = searchParams.get('customerId') ?? '';
  const activityCenterKey = searchParams.get('activityCenterKey') ? decodeURIComponent(searchParams.get('activityCenterKey')!) : '';
  const [data, setData] = useState<ActivityDriverRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo) || !customerId || !activityCenterKey) return;
    getTableData<ActivityDriverRow>(periodNo, 'ActivityDriver').then((rows) => {
      setData(
        rows.filter(
          (r) =>
            r.periodNo === periodNo &&
            r.activityCenterKey === activityCenterKey &&
            r.customerId === customerId
        )
      );
    });
  }, [periodNo, customerId, activityCenterKey]);

  if (isNaN(periodNo) || !customerId || !activityCenterKey) {
    navigate('/page0');
    return null;
  }

  const columns: ColumnDef<ActivityDriverRow, unknown>[] = [
    { accessorKey: 'Activity - Level 2', header: 'Activity - Level 2' },
    { accessorKey: 'Activity Driver', header: 'Activity Driver' },
    {
      accessorKey: 'ActvivtyDriverValue',
      header: 'ActvivtyDriverValue (hours)',
      cell: ({ getValue }) => (getValue() as number) ?? 0,
    },
    {
      accessorKey: 'ActCost',
      header: 'ActCost',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    { accessorKey: 'ValueObject', header: 'ValueObject' },
    { accessorKey: 'ServiceProduct', header: 'ServiceProduct' },
  ];

  const handleRowClick = (row: ActivityDriverRow) => {
    const activityCodeKey = extractCode(row[' Activity - Level 2'] ?? row['Activity - Level 2']);
    navigate(
      `/page4?periodNo=${periodNo}&customerId=${customerId}&activityCenterKey=${encodeURIComponent(activityCenterKey)}&activityCodeKey=${encodeURIComponent(activityCodeKey)}`
    );
  };

  const breadcrumb = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
    { label: customerId, path: `/page1?periodNo=${periodNo}&customerId=${customerId}` },
    { label: '服務成本分析', path: `/page2?periodNo=${periodNo}&customerId=${customerId}` },
    { label: activityCenterKey, path: `/page3?periodNo=${periodNo}&customerId=${customerId}&activityCenterKey=${encodeURIComponent(activityCenterKey)}` },
    { label: '作業動因明細', path: '#' },
  ];

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <DataTable data={data} columns={columns} onRowClick={handleRowClick} />
    </>
  );
}

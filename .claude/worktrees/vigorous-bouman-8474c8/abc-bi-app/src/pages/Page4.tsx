import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRefreshContext } from '../contexts/RefreshContext';
import { DataTable } from '../components/DataTable';
import { Breadcrumb } from '../components/Breadcrumb';
import { getTableData } from '../dataApi';
import { formatCurrency } from '../utils/format';
import type { ActivityCenterModelRow } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export function Page4() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshToken } = useRefreshContext();
  const periodNo = Number(searchParams.get('periodNo'));
  const customerId = searchParams.get('customerId') ?? '';
  const activityCenterKey = searchParams.get('activityCenterKey') ? decodeURIComponent(searchParams.get('activityCenterKey')!) : '';
  const activityCodeKey = searchParams.get('activityCodeKey') ?? '';
  const [data, setData] = useState<ActivityCenterModelRow[]>([]);

  useEffect(() => {
    if (isNaN(periodNo) || !activityCenterKey || !activityCodeKey) return;
    getTableData<ActivityCenterModelRow>(periodNo, 'ActivityCenter+ActivityModel').then((rows) => {
      setData(
        rows.filter(
          (r) =>
            r.periodNo === periodNo &&
            r.activityCenterKey === activityCenterKey &&
            r.activityCodeKey === activityCodeKey
        )
      );
    });
  }, [periodNo, activityCenterKey, activityCodeKey, refreshToken]);

  if (isNaN(periodNo) || !activityCenterKey || !activityCodeKey) {
    navigate('/page0');
    return null;
  }

  const columns: ColumnDef<ActivityCenterModelRow, unknown>[] = [
    { accessorKey: 'Activity Center- Level 2', header: 'Activity Center- Level 2' },
    { accessorKey: 'Activity - Level 2', header: 'Activity - Level 2' },
    { accessorKey: 'CostType', header: 'CostType' },
    {
      accessorKey: 'Amount',
      header: 'Amount',
      cell: ({ getValue }) => formatCurrency((getValue() as number) ?? 0),
    },
    {
      accessorKey: 'ActivityCenterDriverRate',
      header: 'ActivityCenterDriverRate',
      cell: ({ getValue }) => (getValue() as number) ?? 0,
    },
    {
      accessorKey: 'ActivityCenterDriverValue',
      header: 'ActivityCenterDriverValue',
      cell: ({ getValue }) => (getValue() as number) ?? 0,
    },
    { accessorKey: 'ProductiviityAttribute', header: 'ProductiviityAttribute' },
  ];

  const breadcrumb = [
    { label: '顧客總覽', path: `/page0?periodNo=${periodNo}` },
    { label: customerId, path: `/page1?periodNo=${periodNo}&customerId=${customerId}` },
    { label: '服務成本分析', path: `/page2?periodNo=${periodNo}&customerId=${customerId}` },
    { label: activityCenterKey, path: `/page3?periodNo=${periodNo}&customerId=${customerId}&activityCenterKey=${encodeURIComponent(activityCenterKey)}` },
    { label: activityCodeKey, path: '#' },
    { label: '作業中心成本率', path: '#' },
  ];

  return (
    <>
      <Breadcrumb items={breadcrumb} />
      <div className="page-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            navigate(
              `/page5?periodNo=${periodNo}&activityCenterKey=${encodeURIComponent(activityCenterKey)}`
            )
          }
        >
          📦 資源明細
        </button>
      </div>
      <DataTable data={data} columns={columns} />
    </>
  );
}

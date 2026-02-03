import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PeriodSelector } from './PeriodSelector';
import { UploadExcelButton } from './UploadExcelButton';
import { getPeriodInfo, getAllPeriods } from '../dataApi';
import type { PeriodInfo } from '../types';

export function Header() {
  const [periodNo, setPeriodNo] = useState<number | null>(null);
  const [sheetStatus, setSheetStatus] = useState<Record<string, boolean>>({});
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getAllPeriods().then(setPeriods);
  }, [refreshKey]);

  const loadStatus = async (no: number) => {
    const info = await getPeriodInfo(no);
    setSheetStatus(info?.sheetStatus ?? {});
  };

  useEffect(() => {
    if (periodNo != null && !isNaN(periodNo)) loadStatus(periodNo);
  }, [periodNo]);

  const required = [
    'Resource',
    'ActivityCenter+ActivityModel',
    'ActivityDriver',
    'CustomerServiceCost',
    'IncomeStatment',
    'CustomerProfitResult',
    'ProductProfitResult',
    'CustomerProductProfit',
  ];
  const okCount = required.filter((s) => sheetStatus[s]).length;
  const allOk = okCount === required.length;

  return (
    <header className="header">
      <Link to={currentPeriodNo ? `/page0?periodNo=${currentPeriodNo}` : '/page0'} className="header-title">
        <h1>ABC BI</h1>
      </Link>
      <span className="header-period">
        Period: <PeriodSelector onPeriodChange={setPeriodNo} />
      </span>
      <span className={`sheet-status ${allOk ? 'ok' : 'error'}`}>
        {okCount}/{required.length} {allOk ? 'OK ✓' : ''}
      </span>
      <UploadExcelButton onUploaded={() => { setRefreshKey((k) => k + 1); if (periodNo != null) loadStatus(periodNo); }} />
    </header>
  );
}

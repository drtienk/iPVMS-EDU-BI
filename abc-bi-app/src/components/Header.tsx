import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRefreshContext } from '../contexts/RefreshContext';
import { PeriodSelector } from './PeriodSelector';
import { UploadExcelButton } from './UploadExcelButton';
import { getPeriodInfo, getAllPeriods, deletePeriod } from '../dataApi';
import type { PeriodInfo } from '../types';

export function Header() {
  const navigate = useNavigate();
  const { refreshToken, triggerRefresh } = useRefreshContext();
  const [periodNo, setPeriodNo] = useState<number | null>(null);
  const [sheetStatus, setSheetStatus] = useState<Record<string, boolean>>({});
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    getAllPeriods().then(setPeriods);
  }, [refreshToken]);

  const loadStatus = async (no: number) => {
    const info = await getPeriodInfo(no);
    setSheetStatus(info?.sheetStatus ?? {});
  };

  useEffect(() => {
    if (periodNo != null && !isNaN(periodNo)) loadStatus(periodNo);
  }, [periodNo]);

  const canDeletePeriod = periodNo != null && !isNaN(periodNo) && periods.some((p) => p.periodNo === periodNo);

  const handleDeletePeriod = async () => {
    if (periodNo == null || !canDeletePeriod) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete period ${periodNo}? This will remove all stored tables for this period.`
    );
    if (!confirmed) return;
    try {
      await deletePeriod(periodNo);
      const newPeriods = await getAllPeriods();
      setPeriods(newPeriods);
      triggerRefresh();
      const wasCurrent = true;
      if (wasCurrent) {
        setSheetStatus({});
        if (newPeriods.length > 0) {
          const nextNo = newPeriods[0].periodNo;
          setPeriodNo(nextNo);
          navigate(`/page0?periodNo=${nextNo}`);
        } else {
          setPeriodNo(null);
          navigate('/page0');
        }
      }
      setDeleteMessage('Period deleted');
      setTimeout(() => setDeleteMessage(null), 2000);
    } catch (err) {
      setDeleteMessage('Failed to delete period');
      setTimeout(() => setDeleteMessage(null), 2000);
    }
  };

  const handleUploaded = (latestPeriodNo?: number) => {
    triggerRefresh();
    if (periodNo != null) loadStatus(periodNo);
    if (latestPeriodNo != null) {
      setPeriodNo(latestPeriodNo);
      navigate(`/page0?periodNo=${latestPeriodNo}`);
    }
  };

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
      <Link to={periodNo != null ? `/page0?periodNo=${periodNo}` : '/page0'} className="header-title">
        <h1>ABC BI</h1>
      </Link>
      <span className="header-period">
        Period: <PeriodSelector periods={periods} refreshKey={refreshToken} onPeriodChange={setPeriodNo} />
        <button
          type="button"
          className="header-refresh"
          onClick={triggerRefresh}
          title="Reload data from IndexedDB"
          aria-label="Refresh"
        >
          Refresh
        </button>
        <button
          type="button"
          className="header-delete-period"
          onClick={handleDeletePeriod}
          disabled={!canDeletePeriod}
          title="Delete uploaded period"
          aria-label="Delete uploaded period"
        >
          Delete
        </button>
      </span>
      {deleteMessage != null && <span className="header-delete-message">{deleteMessage}</span>}
      <span className={`sheet-status ${allOk ? 'ok' : 'error'}`}>
        {okCount}/{required.length} {allOk ? 'OK ✓' : ''}
      </span>
      <UploadExcelButton onUploaded={handleUploaded} />
    </header>
  );
}

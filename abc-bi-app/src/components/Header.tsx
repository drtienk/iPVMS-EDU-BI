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

  const handleDeleteAll = async () => {
    if (periods.length === 0) return;
    const confirmed = window.confirm(
      `Delete ALL ${periods.length} period(s)? This removes every uploaded period and all stored tables. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      for (const p of [...periods]) {
        await deletePeriod(p.periodNo);
      }
      setPeriods([]);
      setSheetStatus({});
      setPeriodNo(null);
      triggerRefresh();
      navigate('/page0');
      setDeleteMessage('All periods deleted');
      setTimeout(() => setDeleteMessage(null), 2000);
    } catch {
      setDeleteMessage('Failed to delete all periods');
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
      <div className="header-brand">
        <Link to={periodNo != null ? `/page0?periodNo=${periodNo}` : '/page0'} className="header-title">
          <span className="header-logo-mark">iB</span>
          <h1>iPVMS EDU BI</h1>
        </Link>
        <nav className="header-nav">
          <Link to={periodNo != null ? `/page0?periodNo=${periodNo}` : '/page0'} className="header-nav-link">Dashboard</Link>
          <Link to="/leading" className="header-nav-link">Leading Indicator</Link>
        </nav>
      </div>

      <div className="header-actions">
        <span className="header-period">
          <span className="header-period-label">Period</span>
          <PeriodSelector periods={periods} refreshKey={refreshToken} onPeriodChange={setPeriodNo} />
          <button
            type="button"
            className="header-icon-btn"
            onClick={triggerRefresh}
            title="Reload data"
            aria-label="Refresh"
          >
            ↺
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
          <button
            type="button"
            className="header-delete-period"
            onClick={handleDeleteAll}
            disabled={periods.length === 0}
            title="Delete all uploaded periods"
            aria-label="Delete all uploaded periods"
          >
            Delete All
          </button>
        </span>

        <span className={`sheet-status-badge ${allOk ? 'ok' : 'error'}`}>
          {allOk ? `✓ ${okCount}/${required.length}` : `${okCount}/${required.length} sheets`}
        </span>

        {deleteMessage != null && <span className="header-delete-message">{deleteMessage}</span>}

        <UploadExcelButton onUploaded={handleUploaded} />
      </div>
    </header>
  );
}

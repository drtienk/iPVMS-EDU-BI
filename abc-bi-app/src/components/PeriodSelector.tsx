import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAllPeriods } from '../dataApi';
import type { PeriodInfo } from '../types';

export interface PeriodSelectorProps {
  onPeriodChange?: (periodNo: number) => void;
  periods?: PeriodInfo[];
  refreshKey?: number;
}

export function PeriodSelector({ onPeriodChange, periods: externalPeriods, refreshKey }: PeriodSelectorProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalPeriods, setInternalPeriods] = useState<PeriodInfo[]>([]);
  const periods = externalPeriods ?? internalPeriods;
  const current = searchParams.get('periodNo');
  const periodNo = current ? Number(current) : (periods[0]?.periodNo ?? null);

  useEffect(() => {
    if (externalPeriods != null) return;
    getAllPeriods().then(setInternalPeriods);
  }, [externalPeriods]);

  useEffect(() => {
    if (externalPeriods != null) return;
    getAllPeriods().then(setInternalPeriods);
  }, [refreshKey]);

  useEffect(() => {
    if (periodNo != null && !isNaN(periodNo)) onPeriodChange?.(periodNo);
  }, [periodNo, onPeriodChange]);

  useEffect(() => {
    if (periods.length > 0 && (current === null || current === '')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('periodNo', String(periods[0].periodNo));
        return next;
      });
    }
  }, [periods.length]);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!v) return;
    const no = Number(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodNo', String(no));
      return next;
    });
    onPeriodChange?.(no);
  };

  return (
    <select
      className="period-select"
      value={periodNo ?? ''}
      onChange={handleSelect}
    >
      {periods.length === 0 && <option value="">Upload Your Report results</option>}
      {periods.map((p) => (
        <option key={p.periodNo} value={p.periodNo}>
          {p.periodNo}
        </option>
      ))}
    </select>
  );
}

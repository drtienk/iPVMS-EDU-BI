export interface HBRow {
  label: string;
  dataKey?: string;
  total: number;
  periods?: { label: string; value: number }[];
}

export interface HorizontalBarTableProps {
  rows: HBRow[];
  onRowClick?: (row: { key?: string; label: string }) => void;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
}

const defaultFmt = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function HorizontalBarTable({
  rows,
  onRowClick,
  formatValue = defaultFmt,
  emptyMessage = 'No data.',
}: HorizontalBarTableProps) {
  if (rows.length === 0) return <p className="trend-panel-message">{emptyMessage}</p>;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.total)), 1);

  return (
    <div className="hb-table">
      {rows.map((row, i) => {
        const frac = Math.abs(row.total) / maxAbs;
        const isPos = row.total >= 0;
        const barColor = isPos ? 'var(--success)' : 'var(--danger)';
        const clickable = Boolean(onRowClick);

        return (
          <div
            key={i}
            className={`hb-row${clickable ? ' hb-row-clickable' : ''}`}
            onClick={() => onRowClick?.({ key: row.dataKey, label: row.label })}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={(e) => {
              if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onRowClick!({ key: row.dataKey, label: row.label });
              }
            }}
          >
            <div className="hb-rank">{i + 1}</div>
            <div className="hb-content">
              <div className="hb-header-row">
                <span className="hb-label">{row.label}</span>
                <span className="hb-total" style={{ color: barColor }}>{formatValue(row.total)}</span>
              </div>
              <div className="hb-bar-track">
                <div className="hb-bar-fill" style={{ width: `${(frac * 100).toFixed(1)}%`, background: barColor }} />
              </div>
              {row.periods && row.periods.length > 0 && (
                <div className="hb-periods">
                  {row.periods.map((p, j) => (
                    <span key={j} className="hb-period-val" style={{ color: p.value >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      <span className="hb-period-label">{p.label}:</span>
                      {formatValue(p.value)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {clickable && <div className="hb-arrow">›</div>}
          </div>
        );
      })}
    </div>
  );
}

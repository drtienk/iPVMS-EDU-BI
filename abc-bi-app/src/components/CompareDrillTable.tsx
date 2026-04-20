import type { GroupedBarRow } from './GroupedBarRows';

export interface CompareDrillTableProps {
  rows: GroupedBarRow[];
  /** Labels for each column (the compared items) */
  compareLabels: string[];
  /** Header for the row-label column (e.g. "Activity", "Activity Center") */
  rowLabelColumn?: string;
  /** When set, rows are clickable and show a drill badge */
  onRowClick?: (label: string) => void;
  formatValue?: (v: number) => string;
}

const defaultFmt = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function CompareDrillTable({
  rows,
  compareLabels,
  rowLabelColumn = 'Item',
  onRowClick,
  formatValue = defaultFmt,
}: CompareDrillTableProps) {
  if (rows.length === 0) return null;

  const colTotals = compareLabels.map((_, idx) =>
    rows.reduce((s, r) => s + (r.values[idx]?.y ?? 0), 0)
  );

  return (
    <div className="cdt">
      {/* Header */}
      <div className="cdt-header">
        <div className="cdt-label-col cdt-label-col-header">{rowLabelColumn}</div>
        {compareLabels.map((label, idx) => (
          <div key={idx} className="cdt-item-col cdt-item-header">
            <div className="cdt-item-name">{label}</div>
            <div
              className="cdt-item-total"
              style={{ color: colTotals[idx] >= 0 ? 'var(--success)' : 'var(--danger)' }}
            >
              {formatValue(colTotals[idx])}
            </div>
          </div>
        ))}
        <div className="cdt-total-col cdt-total-header">Total</div>
      </div>

      {/* Data rows */}
      {rows.map((row, rowIdx) => {
        const rowTotal = row.total ?? row.values.reduce((s, v) => s + v.y, 0);
        const allVals = row.values.map((v) => v.y);
        const maxAbs = Math.max(...allVals.map(Math.abs), 1);
        const clickable = Boolean(onRowClick);

        return (
          <div
            key={rowIdx}
            className={`cdt-row${clickable ? ' cdt-row-clickable' : ''}${rowIdx % 2 === 1 ? ' cdt-row-alt' : ''}`}
            onClick={() => onRowClick?.(row.group)}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row.group); } } : undefined}
          >
            <div className="cdt-label-col">
              <span className="cdt-activity-label">{row.group}</span>
              {clickable && <span className="cdt-drill-badge">→</span>}
            </div>

            {row.values.map((v, colIdx) => {
              const frac = Math.abs(v.y) / maxAbs;
              const isPos = v.y >= 0;
              return (
                <div key={colIdx} className="cdt-item-col">
                  {v.y !== 0 ? (
                    <>
                      <div
                        className="cdt-cell-value"
                        style={{ color: isPos ? 'var(--text-primary)' : 'var(--danger)' }}
                      >
                        {formatValue(v.y)}
                      </div>
                      <div className="cdt-bar-track">
                        <div
                          className="cdt-bar-fill"
                          style={{
                            width: `${(frac * 100).toFixed(1)}%`,
                            background: isPos ? 'var(--primary)' : 'var(--danger)',
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="cdt-cell-zero">—</div>
                  )}
                </div>
              );
            })}

            <div
              className="cdt-total-col"
              style={{ color: rowTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}
            >
              {formatValue(rowTotal)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

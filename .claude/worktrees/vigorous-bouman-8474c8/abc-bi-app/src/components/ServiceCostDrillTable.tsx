export interface SCDRow {
  activity: string;
  periods: { cost: number; hours: number }[];
  isTotal?: boolean;
}

export interface ServiceCostDrillTableProps {
  rows: SCDRow[];
  periodLabels: string[];
  periodTotals?: number[];
  onRowClick?: (activityCode: string) => void;
  formatValue?: (v: number) => string;
  formatHours?: (h: number) => string;
}

const defaultFmt = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const defaultFmtH = (h: number) =>
  h === 0 ? '—' : `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs`;

function TrendBadge({ costs }: { costs: number[] }) {
  if (costs.length < 2) return null;
  const first = costs[0], last = costs[costs.length - 1];
  if (first === 0 && last === 0) return null;
  const delta = last - first;
  const pct = first !== 0 ? Math.abs(Math.round((delta / Math.abs(first)) * 100)) : null;
  const up = delta > 0;
  return (
    <span className={`scd-trend ${up ? 'scd-trend-up' : 'scd-trend-dn'}`}>
      {up ? '▲' : '▼'}{pct != null ? ` ${pct}%` : ''}
    </span>
  );
}

export function ServiceCostDrillTable({
  rows,
  periodLabels,
  periodTotals,
  onRowClick,
  formatValue = defaultFmt,
  formatHours = defaultFmtH,
}: ServiceCostDrillTableProps) {
  if (rows.length === 0) return null;

  const dataRows = rows.filter((r) => !r.isTotal);
  const totalRow = rows.find((r) => r.isTotal);

  // Max cost across all data rows per period column (for bar widths)
  const maxPerPeriod = periodLabels.map((_, ci) =>
    Math.max(...dataRows.map((r) => Math.abs(r.periods[ci]?.cost ?? 0)), 1)
  );

  return (
    <div className="scd-table">
      {/* Header */}
      <div className="scd-header">
        <div className="scd-activity-col scd-col-header">Activity</div>
        {periodLabels.map((label, i) => (
          <div key={i} className="scd-period-col scd-col-header">
            <div className="scd-period-label">{label}</div>
            {periodTotals && (
              <div className="scd-period-total">{formatValue(periodTotals[i] ?? 0)}</div>
            )}
          </div>
        ))}
        <div className="scd-summary-col scd-col-header">Total</div>
        <div className="scd-trend-col" />
      </div>

      {/* Data rows */}
      {dataRows.map((row, rowIdx) => {
        const totalCost = row.periods.reduce((s, p) => s + p.cost, 0);
        const costs = row.periods.map((p) => p.cost);
        const clickable = Boolean(onRowClick);
        return (
          <div
            key={rowIdx}
            className={`scd-row${clickable ? ' scd-row-clickable' : ''}${rowIdx % 2 === 1 ? ' scd-row-alt' : ''}`}
            onClick={() => onRowClick?.(row.activity)}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row.activity); } } : undefined}
          >
            <div className="scd-activity-col">
              <span className="scd-activity-label">{row.activity}</span>
              {clickable && <span className="scd-drill-arrow">→</span>}
            </div>
            {row.periods.map((p, ci) => {
              const frac = maxPerPeriod[ci] > 0 ? Math.abs(p.cost) / maxPerPeriod[ci] : 0;
              return (
                <div key={ci} className="scd-period-col">
                  {p.cost !== 0 ? (
                    <>
                      <div className="scd-cost-value">{formatValue(p.cost)}</div>
                      <div className="scd-hours-value">{formatHours(p.hours)}</div>
                      <div className="scd-bar-track">
                        <div className="scd-bar-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
                      </div>
                    </>
                  ) : (
                    <div className="scd-zero">—</div>
                  )}
                </div>
              );
            })}
            <div className="scd-summary-col scd-total-val">{formatValue(totalCost)}</div>
            <div className="scd-trend-col"><TrendBadge costs={costs} /></div>
          </div>
        );
      })}

      {/* Footer total row */}
      {totalRow && (
        <div className="scd-row scd-row-footer">
          <div className="scd-activity-col scd-footer-label">Total</div>
          {totalRow.periods.map((p, ci) => (
            <div key={ci} className="scd-period-col">
              <div className="scd-cost-value scd-footer-value">{formatValue(p.cost)}</div>
              <div className="scd-hours-value">{formatHours(p.hours)}</div>
            </div>
          ))}
          <div className="scd-summary-col scd-footer-value">
            {formatValue(totalRow.periods.reduce((s, p) => s + p.cost, 0))}
          </div>
          <div className="scd-trend-col" />
        </div>
      )}
    </div>
  );
}

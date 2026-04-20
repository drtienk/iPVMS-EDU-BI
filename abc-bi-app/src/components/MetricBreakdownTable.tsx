export interface MBMetricRow {
  key: string;
  label: string;
  values: number[];
  drillable?: boolean;
  isSummary?: boolean;
}

export interface MetricBreakdownTableProps {
  metrics: MBMetricRow[];
  /** Period labels for each column, same length as each metric's values array */
  columnLabels: string[];
  /** Called when a drillable row is clicked */
  onDrill?: (metricKey: string) => void;
  formatValue?: (v: number) => string;
}

const defaultFmt = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function TrendBadge({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0 && last === 0) return null;
  const delta = last - first;
  const pct = first !== 0 ? ((delta / Math.abs(first)) * 100).toFixed(0) : null;
  const up = delta > 0;
  return (
    <span className={`mb-trend ${up ? 'mb-trend-up' : 'mb-trend-dn'}`}>
      {up ? '▲' : '▼'}{pct != null ? ` ${Math.abs(Number(pct))}%` : ''}
    </span>
  );
}

export function MetricBreakdownTable({
  metrics,
  columnLabels,
  onDrill,
  formatValue = defaultFmt,
}: MetricBreakdownTableProps) {
  if (metrics.length === 0 || columnLabels.length === 0) return null;

  return (
    <div className="mb-table">
      {/* Header row */}
      <div className="mb-header">
        <div className="mb-label-col" />
        {columnLabels.map((label, i) => (
          <div key={i} className="mb-period-col mb-period-header">{label}</div>
        ))}
        <div className="mb-total-col mb-total-header">Total</div>
        <div className="mb-trend-col" />
      </div>

      {/* Metric rows */}
      {metrics.map((metric) => {
        const total = metric.values.reduce((s, v) => s + v, 0);
        const maxAbs = Math.max(...metric.values.map(Math.abs), 1);
        const clickable = Boolean(metric.drillable && onDrill);
        const totalColor = metric.isSummary
          ? total >= 0 ? 'var(--success)' : 'var(--danger)'
          : 'var(--text-primary)';

        return (
          <div
            key={metric.key}
            className={`mb-row${clickable ? ' mb-row-drillable' : ''}${metric.isSummary ? ' mb-row-summary' : ''}`}
            onClick={clickable ? () => onDrill!(metric.key) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrill!(metric.key); } } : undefined}
          >
            <div className="mb-label-col">
              <span className="mb-metric-label">{metric.label}</span>
              {clickable && <span className="mb-drill-badge">Drill in →</span>}
            </div>

            {metric.values.map((val, colIdx) => {
              const frac = Math.abs(val) / maxAbs;
              const valColor = metric.isSummary ? (val >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text-primary)';
              return (
                <div key={colIdx} className="mb-period-col">
                  <div className="mb-cell-value" style={{ color: valColor }}>{formatValue(val)}</div>
                  {!metric.isSummary && val !== 0 && (
                    <div className="mb-bar-track">
                      <div
                        className="mb-bar-fill"
                        style={{
                          width: `${(frac * 100).toFixed(1)}%`,
                          background: val >= 0 ? 'var(--primary)' : 'var(--danger)',
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <div className="mb-total-col" style={{ color: totalColor }}>
              {formatValue(total)}
            </div>
            <div className="mb-trend-col">
              {!metric.isSummary && <TrendBadge values={metric.values} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

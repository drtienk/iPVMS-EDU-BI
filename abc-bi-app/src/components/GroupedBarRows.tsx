/**
 * Grouped bar rows: one row per category (e.g. product), each row has 1–3 bars (one per period).
 * Used for multi-period drill-down comparison. Supports 1, 2, or 3 periods. No third-party chart lib.
 */

export interface GroupedBarRow {
  group: string;
  values: { x: number | string; y: number }[];
  /** Optional sum of values for this group (e.g. total profitability). Shown in right column when set. */
  total?: number;
  /** Optional key for click callback (e.g. customerId when group is display name). Passed to onBarClick as dataKey. */
  dataKey?: string;
}

export interface MonthTotal {
  period: number;
  total: number;
}

export interface GroupedBarRowsProps {
  rows: GroupedBarRow[];
  /** Format period (e.g. periodNo) for bar bottom label, e.g. MMYYYY */
  formatPeriod: (x: number | string) => string;
  /** Bar fill by value (e.g. profit: green when y>=0, red when y<0) */
  barColor?: (y: number) => string;
  /** Format value above bar */
  barLabelFormatter?: (y: number) => string;
  width?: number;
  /** Width for left column (group name) */
  labelWidth?: number;
  /** When provided, show header row with month labels and column totals; reserve right column for row total */
  monthTotals?: MonthTotal[];
  /** When provided, each bar is clickable and invokes this with group label, period (x), value (y), and optional dataKey from row */
  onBarClick?: (args: { groupLabel: string; period: number; value: number; dataKey?: string }) => void;
  /** Optional label for the first column when monthTotals is shown (e.g. "Product", "Customer") */
  labelColumnTitle?: string;
}

const DEFAULT_WIDTH = 520;
const LABEL_WIDTH = 140;
const TOTAL_COL_WIDTH = 160;
const ROW_HEIGHT = 92;
const INNER_HEIGHT = 58;
const BAR_WIDTH = 12;
const BAR_GAP = 18;
const VALUE_LABEL_GAP = 6;
const MONTH_LABEL_OFFSET = 14;
const HEADER_ROW_HEIGHT = 40;
const BASELINE_FRAC = 0.5;

const DEFAULT_BAR_COLOR = (y: number) => (y < 0 ? '#C62828' : '#2E7D32');

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export function GroupedBarRows({
  rows,
  formatPeriod,
  barColor = DEFAULT_BAR_COLOR,
  barLabelFormatter = (y) => y.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  width = DEFAULT_WIDTH,
  labelWidth = LABEL_WIDTH,
  monthTotals = [],
  onBarClick,
  labelColumnTitle = 'Sales Activity Center',
}: GroupedBarRowsProps) {
  if (rows.length === 0) {
    return (
      <div className="grouped-bar-rows grouped-bar-rows-empty">
        No data
      </div>
    );
  }

  const useTotalColumn = monthTotals.length > 0 || rows.some((r) => r.total !== undefined && r.total !== null);
  const gap = 12;
  const barAreaWidth = width - labelWidth - (useTotalColumn ? TOTAL_COL_WIDTH : 0) - gap * 2;
  const numBars = Math.max(1, rows[0]?.values.length ?? 0);
  const colWidth = barAreaWidth / numBars;
  const barWidth = Math.min(BAR_WIDTH, colWidth - BAR_GAP);
  const baseline = INNER_HEIGHT * BASELINE_FRAC;

  const allValues = rows.flatMap((r) => r.values.map((v) => v.y));
  const valueMin = Math.min(0, ...allValues);
  const valueMax = Math.max(0, ...allValues);

  const scaleY = (y: number): number => {
    if (y >= 0) {
      if (valueMax <= 0) return baseline;
      const frac = y / valueMax;
      return baseline - frac * baseline;
    }
    if (valueMin >= 0) return baseline;
    const frac = y / valueMin;
    return baseline - frac * (INNER_HEIGHT - baseline);
  };

  const barY0 = scaleY(0);

  const formatTotal = (t: number) =>
    t.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  const periods = monthTotals.length > 0
    ? monthTotals.map((m) => m.period)
    : (rows[0]?.values.map((v) => v.x) ?? []);

  return (
    <div className="grouped-bar-rows" style={{ width }}>
      {monthTotals.length > 0 && (
        <div
          className="grouped-bar-row grouped-bar-row-header"
          style={{ height: HEADER_ROW_HEIGHT, borderBottom: '1px solid var(--border)' }}
        >
          <div className="grouped-bar-row-label" style={{ width: labelWidth, fontWeight: 600 }}>
            {labelColumnTitle}
          </div>
          <div className="grouped-bar-row-chart" style={{ display: 'flex', width: barAreaWidth, gap: 0, flexShrink: 0 }}>
            {periods.map((period, i) => (
              <div
                key={i}
                style={{
                  width: colWidth,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 2,
                }}
              >
                <span style={{ fontSize: 10, color: '#555' }}>{formatPeriod(period)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#333' }}>
                  {formatNumber(monthTotals[i]?.total ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {useTotalColumn && (
            <div
              className="grouped-bar-row-total-col"
              style={{
                width: TOTAL_COL_WIDTH,
                textAlign: 'right',
                paddingRight: 8,
                fontSize: 11,
                fontWeight: 600,
                color: '#555',
              }}
            >
              Total
            </div>
          )}
        </div>
      )}
      {rows.map((row, rowIdx) => {
        const showTotal = row.total !== undefined && row.total !== null;
        const totalColor = showTotal && row.total! < 0 ? '#C62828' : '#2E7D32';
        return (
          <div key={rowIdx} className="grouped-bar-row" style={{ height: ROW_HEIGHT }}>
            <div className="grouped-bar-row-label" style={{ width: labelWidth }}>
              {row.group}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: useTotalColumn ? gap : 0,
                minWidth: 0,
                width: useTotalColumn ? barAreaWidth + TOTAL_COL_WIDTH + gap : undefined,
              }}
            >
            <svg
              width={barAreaWidth}
              height={ROW_HEIGHT}
              style={{ overflow: 'visible', flexShrink: 0 }}
            >
              {row.values.map((v, i) => {
                const x = (i + 0.5) * colWidth - barWidth / 2;
                const yVal = v.y;
                const yPixelTop = scaleY(yVal);
                const yPixelBase = barY0;
                const h = Math.abs(yPixelBase - yPixelTop);
                const yRect = yVal >= 0 ? yPixelTop : yPixelBase;
                const fill = barColor(yVal);
                const barCenterX = (i + 0.5) * colWidth;
                const labelY = (yVal >= 0 ? yPixelTop : barY0) - VALUE_LABEL_GAP;

                return (
                  <g key={i}>
                    <rect
                      x={x}
                      y={yRect}
                      width={barWidth}
                      height={h}
                      fill={fill}
                      className="grouped-bar-rect"
                      style={{ cursor: onBarClick ? 'pointer' : undefined }}
                      onClick={(e) => {
                        if (onBarClick) {
                          e.stopPropagation();
                          onBarClick({
                            groupLabel: row.group,
                            period: Number(v.x),
                            value: yVal,
                            dataKey: row.dataKey,
                          });
                        }
                      }}
                    />
                    <text
                      x={barCenterX}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={10}
                      fill={yVal < 0 ? '#C62828' : '#2E7D32'}
                    >
                      {barLabelFormatter(yVal)}
                    </text>
                    <text
                      x={barCenterX}
                      y={INNER_HEIGHT + MONTH_LABEL_OFFSET}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#555"
                    >
                      {formatPeriod(v.x)}
                    </text>
                  </g>
                );
              })}
            </svg>
            {useTotalColumn && (
              <div
                className="grouped-bar-row-total-col"
                style={{
                  width: TOTAL_COL_WIDTH,
                  minWidth: TOTAL_COL_WIDTH,
                  textAlign: 'right',
                  paddingRight: 8,
                  paddingLeft: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: showTotal ? totalColor : '#333',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                {showTotal ? `Total: ${formatTotal(row.total!)}` : '—'}
              </div>
            )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

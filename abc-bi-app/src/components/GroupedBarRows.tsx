/**
 * Grouped bar rows: one row per category (e.g. product), each row has 3 bars (e.g. 3 periods).
 * Used for multi-period drill-down comparison. No third-party chart lib.
 */

export interface GroupedBarRow {
  group: string;
  values: { x: number | string; y: number }[];
  /** Optional sum of values for this group (e.g. total profitability). Shown above bars when set. */
  total?: number;
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
}

const DEFAULT_WIDTH = 520;
const LABEL_WIDTH = 140;
const ROW_HEIGHT = 52;
const ROW_HEIGHT_WITH_TOTAL = 70;
const BAR_CHART_HEIGHT = 28;
const BASELINE = 14;
const MIN_BAR_HEIGHT_FOR_LABEL = 10;

const DEFAULT_BAR_COLOR = (y: number) => (y < 0 ? '#C62828' : '#2E7D32');

export function GroupedBarRows({
  rows,
  formatPeriod,
  barColor = DEFAULT_BAR_COLOR,
  barLabelFormatter = (y) => y.toLocaleString('en-US', { maximumFractionDigits: 0 }),
  width = DEFAULT_WIDTH,
  labelWidth = LABEL_WIDTH,
}: GroupedBarRowsProps) {
  if (rows.length === 0) {
    return (
      <div className="grouped-bar-rows grouped-bar-rows-empty">
        No data
      </div>
    );
  }

  const barAreaWidth = width - labelWidth - 24;
  const numBars = Math.max(1, rows[0]?.values.length ?? 0);
  const barWidth = Math.max(12, (barAreaWidth / numBars) * 0.65);
  const barGap = barAreaWidth / numBars;

  const allValues = rows.flatMap((r) => r.values.map((v) => v.y));
  const valueMin = Math.min(0, ...allValues);
  const valueMax = Math.max(0, ...allValues);
  const valueRange = valueMax - valueMin || 1;

  const scaleY = (y: number): number => {
    if (y >= 0) {
      const frac = valueMax <= 0 ? 0 : y / valueMax;
      return BASELINE - frac * BASELINE;
    }
    const frac = valueMin >= 0 ? 0 : y / valueMin;
    return BASELINE - frac * (BAR_CHART_HEIGHT - BASELINE);
  };

  const barY0 = scaleY(0);

  const formatTotal = (t: number) =>
    t.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  return (
    <div className="grouped-bar-rows" style={{ width }}>
      {rows.map((row, rowIdx) => {
        const showTotal = row.total !== undefined && row.total !== null;
        const rowH = showTotal ? ROW_HEIGHT_WITH_TOTAL : ROW_HEIGHT;
        const totalColor = showTotal && row.total! < 0 ? '#C62828' : '#2E7D32';
        return (
        <div key={rowIdx} className="grouped-bar-row" style={{ height: rowH }}>
          <div className="grouped-bar-row-label" style={{ width: labelWidth }}>
            {row.group}
          </div>
          <div className="grouped-bar-row-chart" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {showTotal && (
              <div
                className="grouped-bar-row-total"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: totalColor,
                  textAlign: 'right',
                  paddingRight: 4,
                }}
              >
                Total: {formatTotal(row.total!)}
              </div>
            )}
          <svg
            width={barAreaWidth}
            height={ROW_HEIGHT}
            style={{ overflow: 'visible' }}
          >
            {row.values.map((v, i) => {
              const x = (i + 0.5) * barGap - barWidth / 2;
              const yVal = v.y;
              const yPixelTop = scaleY(yVal);
              const yPixelBase = barY0;
              const h = Math.abs(yPixelBase - yPixelTop);
              const yRect = yVal >= 0 ? yPixelTop : yPixelBase;
              const fill = barColor(yVal);
              const showLabel = h >= MIN_BAR_HEIGHT_FOR_LABEL;
              const barCenterX = x + barWidth / 2;

              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={yRect}
                    width={barWidth}
                    height={h}
                    fill={fill}
                    className="grouped-bar-rect"
                  />
                  {showLabel && (
                    <text
                      x={barCenterX}
                      y={yRect - 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#333"
                    >
                      {barLabelFormatter(yVal)}
                    </text>
                  )}
                  <text
                    x={barCenterX}
                    y={BAR_CHART_HEIGHT + 14}
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
          </div>
        </div>
      );
      })}
    </div>
  );
}

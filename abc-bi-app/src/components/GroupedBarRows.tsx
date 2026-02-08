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
  /** Format month total (header) and row total. When not set, uses default number format. */
  totalFormatter?: (t: number) => string;
  width?: number;
  /** Width for left column (group name) */
  labelWidth?: number;
  /** When provided, show header row with month labels and column totals; reserve right column for row total */
  monthTotals?: MonthTotal[];
  /** When provided, each bar is clickable and invokes this with group label, period (x), value (y), and optional dataKey from row */
  onBarClick?: (args: { groupLabel: string; period: number; value: number; dataKey?: string }) => void;
  /** When provided, each row is clickable (label + whole row); invokes with row key (e.g. customerId) and label (e.g. customerName) */
  onRowClick?: (row: { key?: string; label: string }) => void;
  /** Optional label for the first column when monthTotals is shown (e.g. "Product", "Customer") */
  labelColumnTitle?: string;
}

const DEFAULT_WIDTH = 520;
const LABEL_WIDTH = 140;
const TOTAL_COL_WIDTH = 120;
const ROW_HEIGHT = 92;
const INNER_HEIGHT = 180;
const BAR_WIDTH = 28;
const BAR_CELL_SVG_WIDTH = 104;
const VALUE_LABEL_GAP = 6;
const HEADER_ROW_HEIGHT = 60;
const BASELINE_FRAC = 0.5;

const DEFAULT_BAR_COLOR = (y: number) => (y < 0 ? '#C62828' : '#2E7D32');

 

export function GroupedBarRows({
  rows,
  formatPeriod,
  barColor = DEFAULT_BAR_COLOR,
  barLabelFormatter = (y) => y.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  totalFormatter,
  width: _width = DEFAULT_WIDTH,
  labelWidth = LABEL_WIDTH,
  monthTotals = [],
  onBarClick,
  onRowClick,
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
  const numBars = Math.max(1, rows[0]?.values.length ?? 0);
  const baseline = INNER_HEIGHT * BASELINE_FRAC;
  const barWidth = Math.min(BAR_WIDTH, BAR_CELL_SVG_WIDTH - 8);

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
    totalFormatter ? totalFormatter(t) : t.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  const periods = monthTotals.length > 0
    ? monthTotals.map((m) => m.period)
    : (rows[0]?.values.map((v) => v.x) ?? []);
  const barsGridClass = `bars-grid cols-${numBars}`;

  return (
    <div className="grouped-bar-rows" style={{ width:'100%' }}>
      {monthTotals.length > 0 && (
        <div
          className="grouped-bar-row grouped-bar-row-header"
          style={{ height: HEADER_ROW_HEIGHT, borderBottom: '1px solid var(--border)' }}
        >
          <div className="grouped-bar-row-label" style={{ width: labelWidth, fontWeight: 600 }}>
            {labelColumnTitle}
          </div>
          <div className={`grouped-bar-row-chart ${barsGridClass}`} style={{ flex:1, minWidth: 0, paddingRight: 52 }}>
          {periods.map((period, i) => (
  <div key={i} className="bar-cell" style={{ paddingBottom: 2 }}>
    <div style={{ width: BAR_CELL_SVG_WIDTH, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#555' }}>{formatPeriod(period)}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#333' }}>
        {formatTotal(monthTotals[i]?.total ?? 0)}
      </div>
    </div>
  </div>
))}

          </div>
          {useTotalColumn && (
            <div
              className="grouped-bar-row-total-col col-total"
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
        const rowClickable = Boolean(onRowClick);
        return (
          <div
            key={rowIdx}
            className={`grouped-bar-row${rowClickable ? ' grouped-bar-row-clickable' : ''}`}
            style={{
              minHeight: ROW_HEIGHT,
              cursor: rowClickable ? 'pointer' : undefined,
            }}
            onClick={() => {
              if (onRowClick) onRowClick({ key: row.dataKey, label: row.group });
            }}
            onKeyDown={(e) => {
              if (!onRowClick) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRowClick({ key: row.dataKey, label: row.group });
              }
            }}
            role={rowClickable ? 'button' : undefined}
            tabIndex={rowClickable ? 0 : undefined}
          >
            <div className="grouped-bar-row-label" style={{ width: labelWidth }}>
              {row.group}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: useTotalColumn ? gap : 0,
                minWidth: 0,
                flex: 1,
              }}
            >
            <div className={`grouped-bar-row-chart ${barsGridClass}`} 
            style={{ flex: 1, minWidth: 0, paddingRight:5}}>
              {row.values.map((v, i) => {
                const yVal = v.y;
                const yPixelTop = scaleY(yVal);
                const yPixelBase = barY0;
                const h = Math.abs(yPixelBase - yPixelTop);
                const yRect = yVal >= 0 ? yPixelTop : yPixelBase;
                const fill = barColor(yVal);
                const barCenterX = BAR_CELL_SVG_WIDTH / 2;
                const labelInside = h >= 22;
                const labelY = labelInside ? (yRect + h / 3) : ((yVal >= 0 ? yPixelTop : barY0) - VALUE_LABEL_GAP);
                const labelText = barLabelFormatter(yVal);
                const approxWidth = String(labelText).length * 8 + 10; // 黑底寬度估算


                
                return (
                  <div key={i} className="bar-cell">
                    <svg
                        width="100%"
                        height={ROW_HEIGHT}
                        viewBox={`0 0 ${BAR_CELL_SVG_WIDTH} ${ROW_HEIGHT}`}
                        preserveAspectRatio="xMidYMax meet"
                        style={{ overflow: 'visible', display: 'block' }}
                    >
                      <g>
                        <rect
                          x={barCenterX - barWidth / 2}
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
                        
                         
                        {/* 黑底（先畫） */}
                        <rect
                          x={barCenterX - approxWidth / 2}
                          y={labelY - 10}
                          width={approxWidth}
                          height={15}
                          rx={3}
                          fill="rgba(0,0,0,0.75)"
                        />

                        {/* 白字（後畫） */}
                        <text
                          x={barCenterX}
                          y={labelY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={15}
                          fill="#fff"
                        >
                          {labelText}
                        </text>

                      </g>
                    </svg>
                  </div>
                );
              })}
            </div>
            {useTotalColumn && (
              <div
                className="grouped-bar-row-total-col col-total"
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
                {showTotal ? formatTotal(row.total!) : '—'}
              </div>
            )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { ReactNode } from 'react';

export interface SimpleChartDatum {
  x: number;
  y: number;
  label?: string;
}

export interface SimpleChartProps {
  data: SimpleChartDatum[];
  type: 'line' | 'bar';
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  /** Bar fill color (bar chart only). When unset, keeps default positive/negative colors. */
  color?: string;
  /** Format value shown above each bar (bar chart only). Default: toLocaleString('en-US', { maximumFractionDigits: 0 }). */
  barLabelFormatter?: (value: number) => string;
  /** Format x-axis labels (e.g. periodNo → MMYYYY). When set, used for bottom labels instead of formatX. */
  xLabelFormatter?: (x: number | string) => string;
  /** When set, bar chart rects are clickable and show pointer cursor. */
  onBarClick?: (datum: SimpleChartDatum) => void;
}

/** Format periodNo (e.g. 202401) as MMYYYY (e.g. "012024"). */
export function formatMonthMMYYYY(periodNo: number | string): string {
  const p = String(periodNo);
  return p.slice(4, 6) + p.slice(0, 4);
}

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 220;
const PAD = { left: 48, right: 16, top: 16, bottom: 36 };

const DEFAULT_BAR_COLOR_POSITIVE = '#1976d2';
const DEFAULT_BAR_COLOR_NEGATIVE = '#e57373';
const MIN_BAR_HEIGHT_FOR_LABEL = 12;

export function SimpleChart({
  data,
  type,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  xLabel,
  yLabel,
  formatX = (x) => String(x),
  formatY = (y) => String(y),
  color,
  barLabelFormatter,
  xLabelFormatter,
  onBarClick,
}: SimpleChartProps) {
  if (data.length === 0) {
    return (
      <div className="simple-chart simple-chart-empty" style={{ width, height }}>
        No data
      </div>
    );
  }

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin || 1;
  const xRange = xMax - xMin || 1;

  const scaleX = (x: number) => PAD.left + ((x - xMin) / xRange) * innerWidth;
  const scaleY = (y: number) => PAD.top + innerHeight - ((y - yMin) / yRange) * innerHeight;

  const points = data.map((d) => `${scaleX(d.x)},${scaleY(d.y)}`).join(' ');
  const barWidth = Math.max(8, (innerWidth / data.length) * 0.6);
  const barGap = innerWidth / data.length;

  const yTicks = 5;
  const tickNodes: ReactNode[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (yMax - yMin) * (i / yTicks);
    const y = scaleY(v);
    tickNodes.push(
      <line key={`y-${i}`} x1={PAD.left} y1={y} x2={PAD.left - 4} y2={y} stroke="#888" strokeWidth={1} />,
      <text key={`yt-${i}`} x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#444">
        {formatY(v)}
      </text>
    );
  }
  const formatBottomLabel = (x: number | string) => (xLabelFormatter != null ? xLabelFormatter(x) : formatX(Number(x)));
  const showBottomLabel = (i: number) => data.length <= 12 || i % 3 === 0;

  data.forEach((d, i) => {
    const tx = scaleX(d.x);
    tickNodes.push(
      <line key={`x-${i}`} x1={tx} y1={PAD.top + innerHeight} x2={tx} y2={PAD.top + innerHeight + 4} stroke="#888" strokeWidth={1} />
    );
    if (showBottomLabel(i)) {
      tickNodes.push(
        <text key={`xt-${i}`} x={tx} y={PAD.top + innerHeight + 14} textAnchor="middle" fontSize={10} fill="#444">
          {formatBottomLabel(d.x)}
        </text>
      );
    }
  });

  return (
    <div className="simple-chart" style={{ width, height }}>
      <svg width={width} height={height} className="simple-chart-svg">
        {xLabel && (
          <text x={PAD.left + innerWidth / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="#666">
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text x={14} y={PAD.top + innerHeight / 2} textAnchor="middle" fontSize={11} fill="#666" transform={`rotate(-90, 14, ${PAD.top + innerHeight / 2})`}>
            {yLabel}
          </text>
        )}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerHeight} stroke="#888" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerHeight} x2={PAD.left + innerWidth} y2={PAD.top + innerHeight} stroke="#888" strokeWidth={1} />
        {tickNodes}
        {type === 'line' && data.length > 0 && (
          <polyline points={points} fill="none" stroke="#1976d2" strokeWidth={2} strokeLinejoin="round" />
        )}
        {type === 'bar' &&
          data.map((d, i) => {
            const x = PAD.left + (i + 0.5) * barGap - barWidth / 2;
            const yTop = scaleY(d.y);
            const yBase = scaleY(0);
            const h = Math.abs(yBase - yTop);
            const y = d.y >= 0 ? yTop : yBase;
            const barFill = color ?? (d.y >= 0 ? DEFAULT_BAR_COLOR_POSITIVE : DEFAULT_BAR_COLOR_NEGATIVE);
            const barLabelText =
              barLabelFormatter != null ? barLabelFormatter(d.y) : d.y.toLocaleString('en-US', { maximumFractionDigits: 0 });
            const showBarLabel = h >= MIN_BAR_HEIGHT_FOR_LABEL;
            const barCenterX = x + barWidth / 2;
            const labelY = y - 4;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  fill={barFill}
                  style={onBarClick ? { cursor: 'pointer' } : undefined}
                  onClick={() => onBarClick?.(d)}
                />
                {showBarLabel && (
                  <text
                    x={barCenterX}
                    y={labelY}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#333"
                  >
                    {barLabelText}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

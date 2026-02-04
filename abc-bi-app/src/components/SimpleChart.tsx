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
}

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 220;
const PAD = { left: 48, right: 16, top: 16, bottom: 36 };

export function SimpleChart({
  data,
  type,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  xLabel,
  yLabel,
  formatX = (x) => String(x),
  formatY = (y) => String(y),
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
  data.forEach((d, i) => {
    const tx = scaleX(d.x);
    tickNodes.push(
      <line key={`x-${i}`} x1={tx} y1={PAD.top + innerHeight} x2={tx} y2={PAD.top + innerHeight + 4} stroke="#888" strokeWidth={1} />,
      <text key={`xt-${i}`} x={tx} y={PAD.top + innerHeight + 14} textAnchor="middle" fontSize={10} fill="#444">
        {formatX(d.x)}
      </text>
    );
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
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={d.y >= 0 ? '#1976d2' : '#e57373'}
              />
            );
          })}
      </svg>
    </div>
  );
}

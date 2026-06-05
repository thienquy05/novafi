/**
 * Tiny inline trend line for KPI cards. Pure SVG — no recharts, no client JS —
 * so it renders straight from the Server Component and stays cheap on mobile.
 * A CSS `stroke-dashoffset` draw-in (see `.spark-line` in globals.css) animates
 * it without scripting, and respects prefers-reduced-motion.
 */
export function Sparkline({
  data,
  color = 'currentColor',
  width = 100,
  height = 28,
  strokeWidth = 2,
  fill = true,
  className = '',
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
  className?: string;
}) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid /0 when the series is flat
  const pad = strokeWidth; // keep the stroke from clipping at the edges
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    // Flat series sits centered rather than glued to the top.
    const y = range === 0 ? height / 2 : pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      style={{ color, display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {fill && <path d={area} fill="currentColor" fillOpacity={0.1} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        vectorEffect="non-scaling-stroke"
        className="spark-line"
      />
    </svg>
  );
}

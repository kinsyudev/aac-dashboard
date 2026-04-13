interface HistoryPoint {
  label: string;
  value: number | null;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getChartPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";

  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
}

export function HistoryChart({
  title,
  points,
  accentClassName,
  formatValue,
}: {
  title: string;
  points: HistoryPoint[];
  accentClassName: string;
  formatValue: (value: number) => string;
}) {
  const validPoints = points.filter((point) => point.value != null);

  if (validPoints.length === 0) {
    return (
      <div className="rounded-xl border p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-muted-foreground text-xs">No history</span>
        </div>
        <div className="bg-muted/30 text-muted-foreground flex h-56 items-center justify-center rounded-lg text-sm">
          No chart data available.
        </div>
      </div>
    );
  }

  const width = 720;
  const height = 240;
  const paddingX = 18;
  const paddingY = 16;
  const minValue = Math.min(...validPoints.map((point) => point.value ?? 0));
  const maxValue = Math.max(...validPoints.map((point) => point.value ?? 0));
  const valueRange = Math.max(maxValue - minValue, 1);

  const chartPoints = validPoints.map((point, index) => {
    const x =
      paddingX +
      (index / Math.max(validPoints.length - 1, 1)) * (width - paddingX * 2);
    const y =
      height -
      paddingY -
      (((point.value ?? minValue) - minValue) / valueRange) *
        (height - paddingY * 2);

    return { x, y };
  });

  const linePath = getChartPath(chartPoints);
  const areaPath = `${linePath} L ${chartPoints.at(-1)?.x.toFixed(1)} ${height - paddingY} L ${chartPoints[0]?.x.toFixed(1)} ${height - paddingY} Z`;
  const firstLabel = validPoints[0]?.label;
  const middleLabel = validPoints[Math.floor(validPoints.length / 2)]?.label;
  const lastLabel = validPoints.at(-1)?.label;
  const latestValue = validPoints.at(-1)?.value ?? 0;

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">
            Latest: {formatValue(latestValue)}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="text-muted-foreground">High</p>
          <p className="font-medium">{formatValue(maxValue)}</p>
          <p className="text-muted-foreground mt-2">Low</p>
          <p className="font-medium">{formatValue(minValue)}</p>
        </div>
      </div>

      <div className="bg-muted/20 rounded-lg p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full overflow-visible"
          role="img"
          aria-label={title}
        >
          <line
            x1={paddingX}
            x2={width - paddingX}
            y1={height - paddingY}
            y2={height - paddingY}
            className="stroke-border"
            strokeWidth="1"
          />
          <path
            d={areaPath}
            className={`${accentClassName} opacity-15`}
            fill="currentColor"
          />
          <path
            d={linePath}
            className={accentClassName}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {chartPoints.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x}
              cy={point.y}
              r="3"
              className={accentClassName}
              fill="currentColor"
            />
          ))}
        </svg>
      </div>

      <div className="text-muted-foreground mt-3 flex items-center justify-between text-xs">
        <span>{firstLabel}</span>
        <span>{middleLabel}</span>
        <span>{lastLabel}</span>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {validPoints.length} snapshots
        </span>
        <span className="font-medium">
          Range {formatCompactNumber(maxValue - minValue)}
        </span>
      </div>
    </div>
  );
}

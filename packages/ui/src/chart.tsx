"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@acme/ui";

const THEMES = { light: "", dark: ".dark" } as const;
const INITIAL_DIMENSION = { width: 320, height: 200 } as const;

interface ChartConfigEntry {
  label?: React.ReactNode;
  icon?: React.ComponentType;
  color?: string;
  theme?: Partial<Record<keyof typeof THEMES, string>>;
}

export type ChartConfig = Record<string, ChartConfigEntry>;

interface ChartContextProps {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer
          initialDimension={initialDimension}
        >
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const styles = Object.entries(THEMES)
    .map(([theme, prefix]) => {
      const lines = Object.entries(config)
        .map(([key, entry]) => {
          const color =
            entry.theme?.[theme as keyof typeof THEMES] ?? entry.color;
          return color ? `  --color-${key}: ${color};` : null;
        })
        .filter((line): line is string => line != null);

      if (lines.length === 0) return null;

      return `${prefix} [data-chart=${id}] {\n${lines.join("\n")}\n}`;
    })
    .filter((block): block is string => block != null)
    .join("\n");

  if (styles.length === 0) {
    return null;
  }

  return <style dangerouslySetInnerHTML={{ __html: styles }} />;
}

export const ChartTooltip = RechartsPrimitive.Tooltip;
export const Recharts = RechartsPrimitive;

export function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

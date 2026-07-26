import type { ReactNode } from "react";

import { cn } from "@acme/ui";

export type SemanticTone =
  | "success"
  | "warning"
  | "destructive"
  | "muted"
  | "incomplete";

const toneClasses: Record<SemanticTone, string> = {
  success: "text-green-600 dark:text-green-400",
  warning: "text-amber-700 dark:text-amber-300",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  incomplete: "text-amber-700 dark:text-amber-300",
};

export function Metric({
  label,
  value,
  detail,
  help,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  help?: ReactNode;
  tone?: SemanticTone;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted/40 rounded-md border p-3", className)}>
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>{label}</span>
        {help}
      </div>
      <p
        className={cn(
          "mt-1 font-medium tabular-nums",
          tone ? toneClasses[tone] : undefined,
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
      ) : null}
    </div>
  );
}

export function MetricGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

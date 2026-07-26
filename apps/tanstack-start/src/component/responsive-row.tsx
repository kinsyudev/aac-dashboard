import type { ReactNode } from "react";

import { cn } from "@acme/ui";

export function ResponsiveRow({
  identity,
  primary,
  secondary,
  value,
  status,
  actions,
  interactive = false,
  className,
}: {
  identity?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  value?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center",
        interactive && "hover:bg-muted/40 -mx-2 rounded-md px-2",
        className,
      )}
    >
      {identity ? <div className="shrink-0">{identity}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{primary}</div>
        {secondary ? (
          <div className="text-muted-foreground text-sm">{secondary}</div>
        ) : null}
      </div>
      {value ? <div className="shrink-0 tabular-nums">{value}</div> : null}
      {status ? <div className="shrink-0">{status}</div> : null}
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

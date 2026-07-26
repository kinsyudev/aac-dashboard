import type { ReactNode } from "react";

import { cn } from "@acme/ui";

type InlineStateKind =
  | "loading"
  | "empty"
  | "unavailable"
  | "incomplete"
  | "warning"
  | "error";

const kindClasses: Record<InlineStateKind, string> = {
  loading: "bg-muted/50 text-muted-foreground",
  empty: "bg-muted/50 text-muted-foreground",
  unavailable: "bg-muted/50 text-muted-foreground",
  incomplete: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-destructive/10 text-destructive",
};

export function InlineState({
  kind,
  title,
  children,
  action,
  className,
}: {
  kind: InlineStateKind;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const isError = kind === "error";
  const announces = isError || kind === "loading" || kind === "incomplete";

  return (
    <div
      role={isError ? "alert" : announces ? "status" : undefined}
      aria-live={announces && !isError ? "polite" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-md px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between",
        kindClasses[kind],
        className,
      )}
    >
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        <div>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

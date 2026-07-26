import type { ReactNode } from "react";

import { Metric } from "~/component/metric";

export function StatCard({
  label,
  value,
  detail,
  variant,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  variant?: "positive" | "negative" | "neutral";
}) {
  return (
    <Metric
      label={label}
      value={value}
      detail={detail}
      tone={
        variant === "positive"
          ? "success"
          : variant === "negative"
            ? "destructive"
            : undefined
      }
    />
  );
}

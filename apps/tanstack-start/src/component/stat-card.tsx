export function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: "positive" | "negative" | "neutral";
}) {
  const colorClass =
    variant === "positive"
      ? "text-green-600 dark:text-green-400"
      : variant === "negative"
        ? "text-red-500"
        : "";

  return (
    <div className="bg-muted/50 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-1 font-medium tabular-nums ${colorClass}`}>{value}</p>
    </div>
  );
}

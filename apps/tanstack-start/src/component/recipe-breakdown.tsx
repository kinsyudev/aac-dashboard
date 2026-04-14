import type { ReactNode } from "react";

import { ProficiencyBadge } from "~/component/proficiency";

export function RecipeCardShell({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border ${depth > 0 ? "bg-muted/20 border-dashed" : ""} p-3`}
    >
      {children}
    </div>
  );
}

export function RecipeHeader({
  depth,
  title,
  proficiency,
  laborLabel,
  materialsLabel,
  collapseToggle,
  action,
}: {
  depth: number;
  title: string;
  proficiency?: string | null;
  laborLabel?: string | null;
  materialsLabel?: string | null;
  collapseToggle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {collapseToggle}
        <p className={`truncate font-semibold ${depth > 0 ? "text-sm" : ""}`}>
          {title}
        </p>
        {proficiency ? <ProficiencyBadge proficiency={proficiency} /> : null}
        {laborLabel ? (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            {laborLabel}
          </span>
        ) : null}
      </div>
      {materialsLabel || action ? (
        <div className="flex shrink-0 items-center gap-3">
          {materialsLabel ? (
            <p className="text-sm font-medium tabular-nums">
              <span className="text-muted-foreground mr-1 text-xs font-normal">
                materials
              </span>
              <span className="text-primary">{materialsLabel}</span>
            </p>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function CraftModeToggle({
  mode,
  onBuy,
  onCraft,
}: {
  mode: "buy" | "craft";
  onBuy: () => void;
  onCraft: () => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-full border text-xs">
      <button
        onClick={onBuy}
        className={`px-2.5 py-0.5 transition-colors ${
          mode === "buy"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Buy
      </button>
      <button
        onClick={onCraft}
        className={`px-2.5 py-0.5 transition-colors ${
          mode === "craft"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Craft
      </button>
    </span>
  );
}

export function RecipeItemRow({
  icon,
  name,
  amount,
  controls,
  value,
  diff,
}: {
  icon: ReactNode;
  name: string;
  amount?: number;
  controls?: ReactNode;
  value?: ReactNode;
  diff?: ReactNode;
}) {
  return (
    <li className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm">
      {icon}
      <span className="min-w-0 flex-1 truncate">
        {name}
        {amount != null && amount > 1 ? (
          <span className="text-muted-foreground ml-1 text-xs">×{amount}</span>
        ) : null}
      </span>
      {controls}
      {value}
      {diff}
    </li>
  );
}

export function RecipeLegend() {
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-0.5 border-t pt-2 text-xs">
      <span>
        <span className="font-medium text-green-600 dark:text-green-400">
          ↓ Xg
        </span>{" "}
        craft saves gold
      </span>
      <span>
        <span className="font-medium text-red-500">↑ Xg</span> craft costs more
      </span>
      <span>
        <span className="font-medium text-amber-500">XL</span> labor to craft
      </span>
      <span>toggle Buy / Craft per ingredient</span>
    </div>
  );
}

export function RecipeCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
      aria-label={collapsed ? "Expand craft" : "Collapse craft"}
    >
      {collapsed ? "▶" : "▼"}
    </button>
  );
}

import type { ReactNode } from "react";

import { Button } from "@acme/ui/button";

import { InlineState } from "~/component/inline-state";
import { ResponsiveRow } from "~/component/responsive-row";

export interface RecipePathLevel {
  id: number;
  name: string;
}

export interface RecipeChoice {
  id: number;
  name: string;
  output: number;
  labor: number;
  cost: ReactNode;
  costPerItem?: ReactNode;
  selected?: boolean;
  recommended?: boolean;
}

export interface RecipeMaterial {
  id: number;
  name: string;
  amount: number;
  mode: "buy" | "craft";
  craftable: boolean;
  price: ReactNode;
  identity?: ReactNode;
  status?: ReactNode;
}

export function RecipeNavigator({
  path,
  focusedItemName,
  choices,
  materials,
  onFocus,
  onRecipeChoice,
  onAcquisitionMode,
  onInspect,
}: {
  path: RecipePathLevel[];
  focusedItemName: string;
  choices: RecipeChoice[];
  materials: RecipeMaterial[];
  onFocus: (itemId: number) => void;
  onRecipeChoice: (recipeId: number) => void;
  onAcquisitionMode?: (itemId: number, mode: "buy" | "craft") => void;
  onInspect?: (itemId: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <nav aria-label="Production path">
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {path.map((level, index) => {
            const focused = index === path.length - 1;
            return (
              <li
                key={`${level.id}-${index}`}
                className="flex items-center gap-1"
              >
                {index > 0 ? (
                  <span className="text-muted-foreground" aria-hidden="true">
                    /
                  </span>
                ) : null}
                {focused ? (
                  <span aria-current="page" className="font-medium">
                    {level.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => onFocus(level.id)}
                  >
                    {level.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-col gap-3" aria-label="Recipe choices">
        <h3 className="font-semibold">Recipe Choices</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.id}
              aria-pressed={choice.selected ?? false}
              onClick={() => onRecipeChoice(choice.id)}
              className="aria-pressed:border-primary aria-pressed:bg-primary/5 hover:bg-muted/40 focus-visible:ring-ring/50 flex min-h-24 flex-col gap-1 rounded-md border p-3 text-left transition-colors outline-none focus-visible:ring-[3px]"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="font-medium">{choice.name}</span>
                {choice.recommended ? (
                  <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                    Recommendation
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">
                {choice.output} output / Craft · {choice.labor} Labor
              </span>
              <span className="text-sm tabular-nums">{choice.cost}</span>
              {choice.costPerItem ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {choice.costPerItem}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Materials for {focusedItemName}</h3>
        {materials.length === 0 ? (
          <InlineState kind="empty">This Recipe has no Materials.</InlineState>
        ) : (
          materials.map((material) => (
            <ResponsiveRow
              key={material.id}
              identity={material.identity}
              primary={
                <>
                  {material.name}{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    ×{material.amount}
                  </span>
                </>
              }
              value={material.price}
              status={material.status}
              actions={
                <>
                  {material.craftable && onAcquisitionMode ? (
                    <div
                      role="group"
                      aria-label={`Acquisition Mode for ${material.name}`}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          material.mode === "buy" ? "default" : "outline"
                        }
                        aria-pressed={material.mode === "buy"}
                        aria-label={`Buy ${material.name}`}
                        onClick={() => onAcquisitionMode(material.id, "buy")}
                      >
                        Buy
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          material.mode === "craft" ? "default" : "outline"
                        }
                        aria-pressed={material.mode === "craft"}
                        aria-label={`Craft ${material.name}`}
                        onClick={() => onAcquisitionMode(material.id, "craft")}
                      >
                        Craft
                      </Button>
                    </div>
                  ) : null}
                  {material.craftable &&
                  material.mode === "craft" &&
                  onInspect ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Inspect ${material.name}`}
                      onClick={() => onInspect(material.id)}
                    >
                      Inspect
                    </Button>
                  ) : null}
                </>
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

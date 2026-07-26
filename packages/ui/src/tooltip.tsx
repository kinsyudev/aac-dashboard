"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@acme/ui";

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "bg-popover text-popover-foreground z-50 max-w-xs rounded-md border px-3 py-2 text-xs shadow-md",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-popover" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function InfoTooltip({
  text,
  side = "top",
}: {
  text: string;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
}) {
  return (
    <Tooltip content={text} side={side}>
      <button
        type="button"
        aria-label={text}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

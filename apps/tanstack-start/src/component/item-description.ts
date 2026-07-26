import { createElement } from "react";

import type { DescriptionSegment } from "./item-description-format.ts";
import { buildItemDescriptionBlocks } from "./item-description-format.ts";

function renderSegments(segments: DescriptionSegment[]) {
  return segments.map((segment, index) =>
    createElement(
      "span",
      {
        key: index,
        style: segment.color ? { color: segment.color } : undefined,
        className: segment.color ? "font-medium" : undefined,
      },
      segment.text,
    ),
  );
}

export function ItemDescription({ text }: { text: string }) {
  return createElement(
    "div",
    {
      className: "text-muted-foreground flex flex-col gap-3 text-sm leading-6",
    },
    buildItemDescriptionBlocks(text).map((block, index) => {
      if (block.type === "paragraph") {
        return createElement(
          "div",
          { key: index, className: "flex flex-col gap-2" },
          block.lines.map((line, lineIndex) =>
            createElement("p", { key: lineIndex }, renderSegments(line)),
          ),
        );
      }
      if (block.type === "list") {
        return createElement(
          "ul",
          {
            key: index,
            className: "marker:text-foreground/60 list-disc space-y-1 pl-5",
          },
          block.items.map((item, itemIndex) =>
            createElement("li", { key: itemIndex }, renderSegments(item)),
          ),
        );
      }
      return createElement(
        "div",
        {
          key: index,
          className:
            "bg-muted/35 divide-border/60 grid gap-2 rounded-lg border px-4 py-3",
        },
        block.rows.map((row, rowIndex) =>
          createElement(
            "div",
            {
              key: rowIndex,
              className:
                "grid gap-1 border-b border-inherit pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4",
            },
            createElement("span", null, renderSegments(row.label)),
            createElement(
              "span",
              { className: "text-foreground sm:text-right" },
              renderSegments(row.value),
            ),
          ),
        ),
      );
    }),
  );
}

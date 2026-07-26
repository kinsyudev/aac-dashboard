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
        { key: index, className: "flex flex-col gap-1" },
        block.rows.map((row, rowIndex) =>
          createElement(
            "div",
            {
              key: rowIndex,
              className: "flex flex-wrap items-baseline gap-x-2",
            },
            createElement(
              "span",
              { className: "font-medium" },
              renderSegments(row.label),
            ),
            createElement(
              "span",
              { className: "text-foreground" },
              renderSegments(row.value),
            ),
          ),
        ),
      );
    }),
  );
}

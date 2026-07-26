import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildItemDescriptionBlocks } from "./item-description-format.ts";
import { ItemDescription } from "./item-description.ts";

void test("parses indexed formatting inline and retains multiline lists", () => {
  const blocks = buildItemDescriptionBlocks(
    "A |nc;7rank 7|r spell lasts |nc;721 seconds|r.\n- First benefit\n- Second benefit",
  );
  const paragraph = blocks[0];
  assert.equal(paragraph?.type, "paragraph");
  assert.equal(
    paragraph.lines[0]?.map((segment) => segment.text).join(""),
    "A rank 7 spell lasts 21 seconds.",
  );
  const list = blocks[1];
  assert.equal(list?.type, "list");
  assert.deepEqual(
    list.items.map((item) => item.map((segment) => segment.text).join("")),
    ["First benefit", "Second benefit"],
  );
});

void test("renders the public description without Game Data tokens", () => {
  const html = renderToStaticMarkup(
    createElement(ItemDescription, {
      text: "A |nc;7rank 7|r spell lasts |nc;721 seconds|r.",
    }),
  );
  assert.match(html, /rank 7.*21 seconds/);
  assert.doesNotMatch(html, /\|nc;7|\|r/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildItemDescriptionBlocks } from "./item-description-format.ts";
import { ItemDescription } from "./item-description.ts";

void test("parses indexed formatting inline and retains multiline lists", () => {
  const blocks = buildItemDescriptionBlocks(
    "This is a rank |nc;7|r |nd;healing|r potion.\nCooldown: |nc;90 seconds|r\n- First benefit\n- Second benefit",
  );
  const paragraph = blocks[0];
  assert.equal(paragraph?.type, "paragraph");
  assert.equal(
    paragraph.lines[0]?.map((segment) => segment.text).join(""),
    "This is a rank 7 healing potion.",
  );
  const stats = blocks[1];
  assert.equal(stats?.type, "stats");
  assert.deepEqual(stats.rows, [
    {
      label: [{ color: undefined, text: "Cooldown" }],
      value: [{ color: undefined, text: "90 seconds" }],
    },
  ]);
  const list = blocks[2];
  assert.equal(list?.type, "list");
  assert.deepEqual(
    list.items.map((item) => item.map((segment) => segment.text).join("")),
    ["First benefit", "Second benefit"],
  );
});

void test("renders the public description without Game Data tokens", () => {
  const html = renderToStaticMarkup(
    createElement(ItemDescription, {
      text: "This is a rank |nc;7|r |nd;healing|r potion.\nCooldown: |nc;90 seconds|r",
    }),
  );
  assert.match(
    html.replace(/<[^>]+>/g, ""),
    /rank 7 healing potion\.Cooldown90 seconds/,
  );
  assert.doesNotMatch(html, /\|nc;|\|nd;|\|r/);
});

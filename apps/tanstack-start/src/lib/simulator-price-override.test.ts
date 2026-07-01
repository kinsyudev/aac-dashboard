import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePriceOverrideInput } from "./simulator-price-override.ts";

void test("parsePriceOverrideInput accepts positive finite gold values", () => {
  assert.equal(parsePriceOverrideInput("12.34"), 12.34);
  assert.equal(parsePriceOverrideInput(" 5 "), 5);
});

void test("parsePriceOverrideInput rejects empty, zero, negative, and invalid values", () => {
  assert.equal(parsePriceOverrideInput(""), null);
  assert.equal(parsePriceOverrideInput("0"), null);
  assert.equal(parsePriceOverrideInput("-1"), null);
  assert.equal(parsePriceOverrideInput("abc"), null);
  assert.equal(parsePriceOverrideInput("Infinity"), null);
});

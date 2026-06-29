import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRecommendedModes,
  getCraftEntryUnitCost,
  getItemPrice,
} from "./simulator-upgrade-pricing.ts";

void test("recommended modes always buy Ayanad conversion scrolls", () => {
  const ayanadScroll = {
    item: { id: 40092, name: "Ayanad Armorsmithing Scroll" },
  };
  const scrollScrap = { item: { id: 8001081, name: "Ayanad Scroll Scrap" } };

  const modes = buildRecommendedModes(
    [ayanadScroll],
    {
      [ayanadScroll.item.id]: [
        {
          craft: {
            id: 8000484,
            name: "Ayanad Armorsmithing Scroll",
            labor: 0,
            proficiency: null,
          },
          materials: [{ ...scrollScrap, amount: 1 }],
          products: [{ item: { id: ayanadScroll.item.id }, amount: 1 }],
        },
      ],
    },
    new Map([
      [ayanadScroll.item.id, { avg24h: "100", avg7d: null, avg30d: null }],
      [scrollScrap.item.id, { avg24h: "1", avg7d: null, avg30d: null }],
    ]),
    new Map(),
  );

  assert.equal(modes[ayanadScroll.item.id], "buy");
});

void test("item pricing uses AH price for Ayanad conversion scrolls", () => {
  const ayanadScrollId = 40091;

  assert.equal(
    getItemPrice(
      ayanadScrollId,
      new Map([[ayanadScrollId, { avg24h: "123", avg7d: null, avg30d: null }]]),
      new Map(),
    ),
    123,
  );
});

void test("Ayanad craft costing buys conversion scrolls even when craft mode is selected", () => {
  const ayanadScroll = {
    item: { id: 40091, name: "Ayanad Weaponsmithing Scroll" },
  };
  const scrollScrap = { item: { id: 8001081, name: "Ayanad Scroll Scrap" } };

  const cost = getCraftEntryUnitCost(
    {
      craft: {
        id: 5144,
        name: "Sealed Ayanad Shortspear",
        labor: 0,
        proficiency: null,
      },
      materials: [{ ...ayanadScroll, amount: 1 }],
      products: [{ item: { id: 31162 }, amount: 1 }],
    },
    31162,
    {
      [ayanadScroll.item.id]: [
        {
          craft: {
            id: 8000483,
            name: "Ayanad Weaponsmithing Scroll",
            labor: 0,
            proficiency: null,
          },
          materials: [{ ...scrollScrap, amount: 1 }],
          products: [{ item: { id: ayanadScroll.item.id }, amount: 1 }],
        },
      ],
    },
    new Map([
      [ayanadScroll.item.id, { avg24h: "100", avg7d: null, avg30d: null }],
      [scrollScrap.item.id, { avg24h: "1", avg7d: null, avg30d: null }],
    ]),
    new Map(),
    { [ayanadScroll.item.id]: "craft" },
  );

  assert.equal(cost, 100);
});

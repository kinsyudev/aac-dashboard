import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCropCatalog,
  findCropSuggestions,
  resolveCatalogItem,
} from "./crop-catalog";
import { parseGrowthTimerSeconds, resolveCropAlias } from "./crop-timers";
import {
  buildTimerNotifications,
  chooseDuration,
  isLikelyPlantableTimerItem,
} from "./timers";

// Names, icon filenames, and relevant description text from the imported game data.
const larders = [
  {
    id: 32095,
    name: "Multi-Purpose Aging Larder",
    description:
      "Used for aging specialty trade packs.\nCan only be installed in specialty crafting areas.\nDisappears in |nc;10 minutes|r if no ingredients are added.\n\nAging Time: 3 days",
    icon: "icon_item_1336.png",
  },
  {
    id: 28940,
    name: "Herb Larder",
    description:
      "This larder was specifically designed to properly age herbs.\n\nAging Period: 5 d",
    icon: "icon_item_1334.png",
  },
  {
    id: 28939,
    name: "Cheese Larder",
    description:
      "This larder was specifically designed to properly age cheese.\n\nAging Period: 5 d",
    icon: "icon_item_1335.png",
  },
  {
    id: 28938,
    name: "Honey Larder",
    description:
      "This larder was specifically designed to properly age honey.\n\nAging Time: 5 d",
    icon: "icon_item_1336.png",
  },
];

void test("larder descriptions parse aging time rather than empty-container expiry", () => {
  assert.equal(
    parseGrowthTimerSeconds(larders[0]?.description ?? null),
    3 * 86400,
  );
  assert.equal(
    parseGrowthTimerSeconds(larders[1]?.description ?? null),
    5 * 86400,
  );
  assert.equal(
    parseGrowthTimerSeconds("Aging Time: |cFFFF9C273 days|r"),
    3 * 86400,
  );
  assert.equal(
    parseGrowthTimerSeconds("Disappears in 10 minutes if empty."),
    null,
  );
});

void test("all imported larders are discoverable and use the confirmed three-day default", () => {
  const candidates = larders.filter(isLikelyPlantableTimerItem);
  assert.equal(candidates.length, 4);
  const catalog = buildCropCatalog(candidates);
  assert.equal(findCropSuggestions(catalog, "larder").length, 4);

  for (const item of larders) {
    const crop = resolveCropAlias(catalog.aliases, item.name);
    assert.ok(crop?.kind === "match");
    assert.equal(crop.item.id, item.id);
    assert.equal(crop.item.icon, item.icon);
    assert.equal(crop.growthSeconds, 3 * 86400);
  }

  for (const alias of [
    "larder",
    "aging larder",
    "multipurpose larder",
    "multi-purpose larder",
  ]) {
    const crop = resolveCatalogItem(catalog, alias);
    assert.ok(crop?.kind === "match");
    assert.equal(crop.item.id, 32095);
  }
  assert.equal(resolveCatalogItem(catalog, "honey"), null);
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Larder Design",
      description: "Used for aging specialty trade packs.",
    }),
    false,
  );
});

void test("larder durations respect overrides and schedule advance and ready reminders", () => {
  const catalog = buildCropCatalog(larders);
  const crop = resolveCropAlias(catalog.aliases, "larder");
  assert.ok(crop?.kind === "match");
  const duration = chooseDuration({
    explicitDurationSeconds: null,
    farmCropOverrideSeconds: null,
    gameTimerSeconds: crop.growthSeconds,
  });
  assert.equal(duration?.durationSeconds, 259200);
  assert.equal(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: 3600,
      gameTimerSeconds: crop.growthSeconds,
    })?.durationSeconds,
    3600,
  );
  assert.equal(
    chooseDuration({
      explicitDurationSeconds: 7200,
      farmCropOverrideSeconds: 3600,
      gameTimerSeconds: crop.growthSeconds,
    })?.durationSeconds,
    7200,
  );

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "larder-timer",
      plantedAt: new Date("2026-09-06T12:00:00Z"),
      durationSeconds: crop.growthSeconds,
      reminderMinutes: 15,
    }),
    [
      { kind: "advance", notifyAt: new Date("2026-09-09T11:45:00Z") },
      { kind: "ready", notifyAt: new Date("2026-09-09T12:00:00Z") },
    ],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimerNotifications,
  chooseDuration,
  chooseReplantDurationMode,
  isLikelyPlantableTimerItem,
  shortTimerId,
} from "./timers";

void test("duration priority uses explicit, override, then game timer", () => {
  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: 50,
      farmCropOverrideSeconds: 60,
      gameTimerSeconds: 70,
    }),
    { durationSeconds: 50, source: "explicit", explicitDurationSeconds: 50 },
  );

  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: 60,
      gameTimerSeconds: 70,
    }),
    {
      durationSeconds: 60,
      source: "farm_crop_override",
      explicitDurationSeconds: null,
    },
  );

  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: null,
      gameTimerSeconds: 70,
    }),
    {
      durationSeconds: 70,
      source: "game_timer",
      explicitDurationSeconds: null,
    },
  );
});

void test("duration selection returns null when no source exists", () => {
  assert.equal(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: null,
      gameTimerSeconds: null,
    }),
    null,
  );
});

void test("advance reminder is skipped when disabled or too close", () => {
  const plantedAt = new Date("2026-07-05T10:00:00.000Z");

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 60 * 60,
      reminderMinutes: 15,
    }),
    [
      {
        kind: "advance",
        notifyAt: new Date("2026-07-05T10:45:00.000Z"),
      },
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T11:00:00.000Z"),
      },
    ],
  );

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 10 * 60,
      reminderMinutes: 15,
    }),
    [
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T10:10:00.000Z"),
      },
    ],
  );

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 60 * 60,
      reminderMinutes: 0,
    }),
    [
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T11:00:00.000Z"),
      },
    ],
  );
});

void test(
  "replant mode freezes explicit durations and recomputes inferred durations",
  () => {
    assert.equal(chooseReplantDurationMode("explicit"), "reuse_explicit");
    assert.equal(chooseReplantDurationMode("farm_crop_override"), "recompute");
    assert.equal(chooseReplantDurationMode("game_timer"), "recompute");
  },
);

void test("short timer id uses first eight uuid characters", () => {
  assert.equal(
    shortTimerId("12345678-90ab-cdef-1234-567890abcdef"),
    "12345678",
  );
});

void test("plantable timer filter includes saplings and braziers", () => {
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Radiant Archeum Tree Sapling",
      description: "Plants an Archeum Tree that can convert Auroria Mineral Water into Archeum.",
    }),
    true,
  );
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Regrade Brazier",
      description: "Places a Regrade Brazier imbued with the magic of Auroria.",
    }),
    true,
  );
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Clockwork Battery",
      description: "Matures in approx. 12 h",
    }),
    false,
  );
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Radiant Archeum Tree Sapling",
      description: null,
    }),
    false,
  );
  assert.equal(
    isLikelyPlantableTimerItem({
      name: "Lucky Sapling Pouch",
      description: "Contains the following items.",
    }),
    false,
  );
});

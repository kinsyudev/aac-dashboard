import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFarmSlug, resolveReminderDefaults } from "./farms";

void test("normalizes farm slugs", () => {
  assert.equal(normalizeFarmSlug(" Main Farm "), "main-farm");
  assert.equal(normalizeFarmSlug("main_farm"), "main-farm");
  assert.equal(normalizeFarmSlug("main--farm"), "main-farm");
});

void test("resolves reminder channel fallback", () => {
  assert.deepEqual(
    resolveReminderDefaults({
      explicitChannelId: "explicit-channel",
      explicitRoleId: null,
      farmDefaultChannelId: "farm-channel",
      farmDefaultRoleId: "farm-role",
      userDefaultChannelId: "user-channel",
      userDefaultRoleId: "user-role",
      commandChannelId: "command-channel",
      ownerDiscordUserId: "user-1",
    }),
    {
      reminderChannelId: "explicit-channel",
      pingRoleId: "farm-role",
      pingUserId: null,
    },
  );
});

void test("falls back to planting user when no role exists", () => {
  assert.deepEqual(
    resolveReminderDefaults({
      explicitChannelId: null,
      explicitRoleId: null,
      farmDefaultChannelId: null,
      farmDefaultRoleId: null,
      userDefaultChannelId: null,
      userDefaultRoleId: null,
      commandChannelId: "command-channel",
      ownerDiscordUserId: "user-1",
    }),
    {
      reminderChannelId: "command-channel",
      pingRoleId: null,
      pingUserId: "user-1",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ReminderMessageInput } from "./messages";
import {
  buildItemEmbed,
  buildReminderMessage,
  buildReplantDurationChoice,
} from "./messages";

const reminder: ReminderMessageInput = {
  timerId: "12345678-90ab-cdef-1234-567890abcdef",
  kind: "ready",
  cropName: "Multi-Purpose Aging Larder",
  cropIcon: "icon_item_3882.png",
  note: "West farm",
  farmSlug: "main",
  plantedByDiscordUserId: "planter",
  pingRoleId: "farm-role",
  readyAt: new Date("2026-09-09T12:00:00Z"),
  durationSeconds: 259200,
  lateBySeconds: 0,
};

void test("advance and ready reminders use the item's game CDN icon and preserve pings", () => {
  for (const kind of ["advance", "ready"] as const) {
    const message = buildReminderMessage({ ...reminder, kind });
    const first = message.embeds?.[0];
    assert.ok(first);
    const embed = "toJSON" in first ? first.toJSON() : first;
    assert.deepEqual(embed.thumbnail, {
      url: "https://aa-classic.com/game/icons/icon_item_3882.png",
    });
    assert.equal(
      message.content,
      kind === "advance" ? "<@planter>" : "<@&farm-role>",
    );
    assert.equal(message.components?.length ?? 0, kind === "ready" ? 1 : 0);
    assert.ok(
      embed.fields?.some(
        (field) => field.name === "Duration" && field.value === "3d",
      ),
    );
  }
});

void test("missing icons leave a usable reminder without a broken thumbnail", () => {
  const message = buildReminderMessage({ ...reminder, cropIcon: null });
  const first = message.embeds?.[0];
  assert.ok(first);
  const embed = "toJSON" in first ? first.toJSON() : first;
  assert.equal(embed.thumbnail, undefined);
  assert.equal(embed.title, "Multi-Purpose Aging Larder is ready");
});

void test("confirmation embeds use stored filenames rather than assuming icon and item IDs match", () => {
  const embed = buildItemEmbed(
    { title: "Larder timer created" },
    "icon_item_1336.png",
  );
  assert.equal(
    embed.thumbnail?.url,
    "https://aa-classic.com/game/icons/icon_item_1336.png",
  );
  assert.equal(
    buildItemEmbed({ title: "Timer created" }, undefined).thumbnail,
    undefined,
  );
});

void test("custom-duration replants offer reuse and current-default choices", () => {
  const message = buildReplantDurationChoice({
    timerId: reminder.timerId,
    cropName: reminder.cropName,
    durationSeconds: 90 * 60,
  });
  const buttons = message.components[0]?.toJSON().components;

  assert.match(message.content, /custom 1h 30m duration/);
  assert.deepEqual(
    buttons?.map((button) => ("custom_id" in button ? button.custom_id : null)),
    [
      `farm-replant:${reminder.timerId}:reuse`,
      `farm-replant:${reminder.timerId}:default`,
    ],
  );
});

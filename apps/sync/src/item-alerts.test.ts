import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDiscordItemMessage,
  getPendingItemAlertDeliveries,
  sendPendingItemAlerts,
} from "./item-alerts";

const discoveredAt = new Date("2026-06-03T10:00:00.000Z");
const beforeDiscovery = new Date("2026-06-03T09:59:59.000Z");
const afterDiscovery = new Date("2026-06-03T10:00:01.000Z");

const item = {
  id: 16323,
  name: "Rising Star Stone",
  category: "Stone",
  level: 1,
  icon: "rising_star_stone.png",
  maxStackSize: 100,
};

void test("pending item alert deliveries include only enabled future-eligible destinations", () => {
  const pending = getPendingItemAlertDeliveries({
    deliveries: [],
    destinations: [
      {
        id: "enabled-before",
        name: "Enabled Before",
        channelId: "111",
        enabled: true,
        createdAt: beforeDiscovery,
      },
      {
        id: "enabled-after",
        name: "Enabled After",
        channelId: "222",
        enabled: true,
        createdAt: afterDiscovery,
      },
      {
        id: "disabled-before",
        name: "Disabled Before",
        channelId: "333",
        enabled: false,
        createdAt: beforeDiscovery,
      },
    ],
    discoveries: [{ item, discoveredAt }],
  });

  assert.deepEqual(
    pending.map((delivery) => delivery.destination.id),
    ["enabled-before"],
  );
});

void test("pending item alert deliveries do not retry sent deliveries", () => {
  const pending = getPendingItemAlertDeliveries({
    destinations: [
      {
        id: "enabled-before",
        name: "Enabled Before",
        channelId: "111",
        enabled: true,
        createdAt: beforeDiscovery,
      },
    ],
    deliveries: [
      {
        itemId: item.id,
        destinationId: "enabled-before",
        sentAt: new Date("2026-06-03T10:01:00.000Z"),
      },
    ],
    discoveries: [{ item, discoveredAt }],
  });

  assert.equal(pending.length, 0);
});

void test("pending item alert deliveries retry failed deliveries", () => {
  const pending = getPendingItemAlertDeliveries({
    destinations: [
      {
        id: "enabled-before",
        name: "Enabled Before",
        channelId: "111",
        enabled: true,
        createdAt: beforeDiscovery,
      },
    ],
    deliveries: [
      {
        itemId: item.id,
        destinationId: "enabled-before",
        sentAt: null,
      },
    ],
    discoveries: [{ item, discoveredAt }],
  });

  assert.deepEqual(
    pending.map((delivery) => delivery.destination.id),
    ["enabled-before"],
  );
});

void test("discord item message is formatted with item facts and links", () => {
  const payload = buildDiscordItemMessage(item);
  const embed = payload.embeds[0];

  assert.equal(payload.embeds.length, 1);
  assert.ok(embed);
  assert.equal(embed.title, "New item: Rising Star Stone");
  assert.equal(embed.url, "https://aac.kinsyu.dev/item/16323");
  assert.equal(
    embed.thumbnail?.url,
    "https://aa-classic.com/game/icons/rising_star_stone.png",
  );
  assert.deepEqual(embed.fields, [
    { name: "ID", value: "16323", inline: true },
    { name: "Category", value: "Stone", inline: true },
    { name: "Level", value: "1", inline: true },
    { name: "Max stack", value: "100", inline: true },
    {
      name: "Links",
      value:
        "[Dashboard](https://aac.kinsyu.dev/item/16323) | [AA Classic DB](https://aa-classic.com/database/items/16323)",
      inline: false,
    },
  ]);
});

void test("sendPendingItemAlerts records successful Discord sends", async () => {
  const events: unknown[] = [];
  const response = {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: "discord-message-1" }),
    text: () => Promise.resolve(""),
  } as Response;

  await sendPendingItemAlerts({
    botToken: "token",
    deliveries: [
      {
        item,
        discoveredAt,
        destination: {
          id: "enabled-before",
          name: "Enabled Before",
          channelId: "111",
          enabled: true,
          createdAt: beforeDiscovery,
        },
      },
    ],
    fetch: () => Promise.resolve(response),
    now: () => new Date("2026-06-03T10:02:00.000Z"),
    recordAttempt: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  });

  assert.deepEqual(events, [
    {
      itemId: item.id,
      destinationId: "enabled-before",
      attemptedAt: new Date("2026-06-03T10:02:00.000Z"),
      success: true,
      discordMessageId: "discord-message-1",
    },
  ]);
});

void test("sendPendingItemAlerts records failed Discord sends for retry", async () => {
  const events: unknown[] = [];
  const response = {
    ok: false,
    status: 500,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("server unavailable"),
  } as Response;

  await sendPendingItemAlerts({
    botToken: "token",
    deliveries: [
      {
        item,
        discoveredAt,
        destination: {
          id: "enabled-before",
          name: "Enabled Before",
          channelId: "111",
          enabled: true,
          createdAt: beforeDiscovery,
        },
      },
    ],
    fetch: () => Promise.resolve(response),
    now: () => new Date("2026-06-03T10:02:00.000Z"),
    recordAttempt: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  });

  assert.deepEqual(events, [
    {
      itemId: item.id,
      destinationId: "enabled-before",
      attemptedAt: new Date("2026-06-03T10:02:00.000Z"),
      success: false,
      error: "Discord HTTP 500: server unavailable",
    },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { BotLogger } from "./logging";
import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
  logSchedulerEvent,
} from "./logging";

function createLogger() {
  const entries: { level: string; payload: Record<string, unknown> }[] = [];
  const parsePayload = (message: string): Record<string, unknown> =>
    JSON.parse(message) as Record<string, unknown>;

  const logger: BotLogger = {
    debug(message) {
      entries.push({ level: "debug", payload: parsePayload(message) });
    },
    info(message) {
      entries.push({ level: "info", payload: parsePayload(message) });
    },
    warn(message) {
      entries.push({ level: "warn", payload: parsePayload(message) });
    },
    error(message) {
      entries.push({ level: "error", payload: parsePayload(message) });
    },
  };

  return { logger, entries };
}

function firstEntry(
  entries: { level: string; payload: Record<string, unknown> }[],
) {
  const entry = entries[0];
  assert.ok(entry);
  return entry;
}

void test("logs interaction start with normalized option payloads", () => {
  const { logger, entries } = createLogger();

  logInteractionStart(logger, {
    interactionType: "chat_input",
    commandName: "plant",
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    options: {
      crop: "Regrade Brazier",
      duration: "7h",
      role: { id: "role-1", name: "Farm" },
      when: new Date("2026-07-09T12:00:00.000Z"),
    },
  });

  assert.deepEqual(entries, [
    {
      level: "info",
      payload: {
        timestamp: entries[0]?.payload.timestamp,
        event: "interaction_started",
        interactionType: "chat_input",
        commandName: "plant",
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-1",
        options: {
          crop: "Regrade Brazier",
          duration: "7h",
          role: "role-1",
          when: "2026-07-09T12:00:00.000Z",
        },
      },
    },
  ]);
});

void test("logs interaction finish with outcome and result metadata", () => {
  const { logger, entries } = createLogger();

  logInteractionFinish(logger, {
    interactionType: "button",
    commandName: "replant",
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    outcome: "ok",
    durationMs: 42,
    result: {
      timerId: "abc123",
      readyAt: new Date("2026-07-09T12:00:00.000Z"),
    },
  });

  const entry = firstEntry(entries);
  assert.equal(entry.level, "info");
  assert.match(String(entry.payload.timestamp), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(entry.payload.result, {
    timerId: "abc123",
    readyAt: "2026-07-09T12:00:00.000Z",
  });
});

void test("logs serialized errors for failed interactions", () => {
  const { logger, entries } = createLogger();

  logInteractionError(logger, {
    interactionType: "autocomplete",
    commandName: "plant",
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    durationMs: 99,
    error: new Error("boom"),
  });

  const entry = firstEntry(entries);
  assert.equal(entry.level, "error");
  assert.match(String(entry.payload.timestamp), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.payload.event, "interaction_failed");
  assert.equal((entry.payload.error as { message?: string }).message, "boom");
});

void test("logs scheduler delivery events", () => {
  const { logger, entries } = createLogger();

  logSchedulerEvent(logger, {
    event: "notification_delivered",
    timerId: "timer-1",
    notificationId: "notification-1",
    notificationKind: "ready",
    guildId: "guild-1",
    channelId: "channel-1",
    attemptCount: 1,
    durationMs: 15,
  });

  assert.deepEqual(entries, [
    {
      level: "info",
      payload: {
        timestamp: entries[0]?.payload.timestamp,
        event: "notification_delivered",
        timerId: "timer-1",
        notificationId: "notification-1",
        notificationKind: "ready",
        guildId: "guild-1",
        channelId: "channel-1",
        attemptCount: 1,
        durationMs: 15,
      },
    },
  ]);
});

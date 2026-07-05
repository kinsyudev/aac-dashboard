import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, parseDurationSeconds } from "./duration";

void test("parses compact duration units", () => {
  assert.equal(parseDurationSeconds("45m"), 45 * 60);
  assert.equal(parseDurationSeconds("1h 30m"), 90 * 60);
  assert.equal(parseDurationSeconds("2d 4h"), 52 * 60 * 60);
  assert.equal(parseDurationSeconds("90m"), 90 * 60);
  assert.equal(parseDurationSeconds("3600s"), 3600);
});

void test("rejects vague and invalid durations", () => {
  assert.equal(parseDurationSeconds("tomorrow"), null);
  assert.equal(parseDurationSeconds("half hour"), null);
  assert.equal(parseDurationSeconds("1hour"), null);
  assert.equal(parseDurationSeconds("0m"), null);
  assert.equal(parseDurationSeconds("15"), null);
});

void test("caps duration at 14 days", () => {
  assert.equal(parseDurationSeconds("14d"), 14 * 24 * 60 * 60);
  assert.equal(parseDurationSeconds("14d 1s"), null);
});

void test("formats durations for Discord messages", () => {
  assert.equal(formatDuration(45 * 60), "45m");
  assert.equal(formatDuration(90 * 60), "1h 30m");
  assert.equal(formatDuration(52 * 60 * 60), "2d 4h");
  assert.equal(formatDuration(3600), "1h");
});

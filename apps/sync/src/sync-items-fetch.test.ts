import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchJsonWithRetry } from "./sync-items-fetch";

void test("upstream JSON fetch retries transient failures", async () => {
  let calls = 0;
  const result = await fetchJsonWithRetry<{ ok: boolean }>({
    url: "https://example.test/data.json",
    attempts: 3,
    timeoutMs: 100,
    fetchImpl: () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("transient"));
      return Promise.resolve(new Response('{"ok":true}'));
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

void test("upstream JSON fetch fails after its bounded attempts", async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry({
      url: "https://example.test/data.json",
      attempts: 2,
      timeoutMs: 100,
      fetchImpl: () => {
        calls++;
        return Promise.reject(new Error("still unavailable"));
      },
    }),
    /still unavailable/,
  );
  assert.equal(calls, 2);
});

import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryNotification } from "./scheduler";

void test("retries failed notifications up to five attempts", () => {
  assert.equal(shouldRetryNotification({ attemptCount: 0 }), true);
  assert.equal(shouldRetryNotification({ attemptCount: 4 }), true);
  assert.equal(shouldRetryNotification({ attemptCount: 5 }), false);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./validate-env.ts", import.meta.url));

function validate(overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", validator], {
    env: {
      ...process.env,
      CI: "true",
      AAC_DISCORD_BOT_TOKEN: "test-token",
      AAC_DISCORD_GUILD_ID: undefined,
      DATABASE_URL: "postgresql://test:test@localhost/test",
      NODE_ENV: "production",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 10_000,
  });
}

void test("build environment validation succeeds without contacting external services", () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
});

void test("build environment validation rejects missing required values even in CI", () => {
  for (const key of ["AAC_DISCORD_BOT_TOKEN", "DATABASE_URL"]) {
    for (const value of [undefined, ""]) {
      const result = validate({ [key]: value });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Invalid environment variables/);
    }
  }
});

void test("build environment validation rejects invalid NODE_ENV", () => {
  const result = validate({ NODE_ENV: "invalid" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Invalid environment variables/);
});

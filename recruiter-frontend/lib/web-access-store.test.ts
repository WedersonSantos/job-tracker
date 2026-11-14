import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getWebConfig, saveWebConfig, removeWebConfig } from "./web-access-store";
import { createWebConfig } from "./web-access-core";

test("private config is persistent, replaceable and fails closed on corruption", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "jobtracker-config-test-"));
  const previous = process.env.JOBTRACKER_WEB_CONFIG;
  const target = join(fixture, "web-access.json");
  process.env.JOBTRACKER_WEB_CONFIG = target;
  try {
    assert.equal(getWebConfig(), null);
    const first = createWebConfig("https://tracker.example.com", "synthetic-password-123");
    await saveWebConfig(first); assert.deepEqual(getWebConfig(), first);
    const second = createWebConfig(first.origin, "synthetic-password-456");
    await saveWebConfig(second); assert.deepEqual(getWebConfig(), second);
    await writeFile(target, "{broken"); assert.throws(() => getWebConfig());
    await writeFile(target, JSON.stringify({ version: 1 })); assert.throws(() => getWebConfig());
    await removeWebConfig(); assert.equal(getWebConfig(), null);
  } finally {
    if (previous === undefined) delete process.env.JOBTRACKER_WEB_CONFIG;
    else process.env.JOBTRACKER_WEB_CONFIG = previous;
    // This one file is created by this test; no user directories are removed.
    await rm(target, { force: true });
  }
});

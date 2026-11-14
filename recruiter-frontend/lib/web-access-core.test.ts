import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebConfig, makeSession, normalizeWebOrigin, passwordMatches, requestAccess, safeReturnPath, SESSION_SECONDS, sessionValid, validateWebConfig } from "./web-access-core";

const config = createWebConfig("https://tracker.example.com", "synthetic-passphrase-123");
test("passwords are salted hashes and enforce length", () => {
  assert(passwordMatches("synthetic-passphrase-123", config.passwordHash));
  assert(!passwordMatches("wrong", config.passwordHash));
  assert(!passwordMatches("a".repeat(129), config.passwordHash));
  assert.notEqual(config.passwordHash, createWebConfig(config.origin, "synthetic-passphrase-123").passwordHash);
  assert.throws(() => createWebConfig(config.origin, "short"));
  assert.throws(() => validateWebConfig({ ...config, sessionSecret: "" }));
});
test("public origin requires HTTPS and contains no credentials or subpath", () => {
  for (const url of ["http://tracker.example.com", "https://user:pass@tracker.example.com", "https://tracker.example.com/path", "https://tracker.example.com?query", "https://tracker.example.com/#hash"])
    assert.throws(() => normalizeWebOrigin(url));
  assert.equal(normalizeWebOrigin("https://tracker.example.com/"), config.origin);
});
test("host policy blocks rebinding and forwarded header impersonation", () => {
  assert.deepEqual(requestAccess("127.0.0.1:3000", null, "http", null), { origin: "http://127.0.0.1:3000", local: true });
  assert.equal(requestAccess("evil.example.com", "localhost:3000", "https", config), null);
  assert.equal(requestAccess("127.0.0.1:3000", "evil.example.com", "https", config), null);
  assert.equal(requestAccess("tracker.example.com", null, "https", null), null);
  assert.equal(requestAccess("tracker.example.com", null, "http", config), null);
  assert.equal(requestAccess("tracker.example.com", null, "https,http", config), null);
  assert.equal(requestAccess("tracker.example.com@evil.test", null, "https", config), null);
  assert.deepEqual(requestAccess("127.0.0.1:3000", "tracker.example.com", "https", config), { origin: config.origin, local: false });
  assert.deepEqual(requestAccess("tracker.example.com", null, "https", config), { origin: config.origin, local: false });
  assert.equal(requestAccess("localhost:80", null, "http", null)?.origin, "http://localhost");
});
test("sessions expire, bind origin, reject tampering and rotate with password", () => {
  const now = Date.now(), token = makeSession(config, config.origin, now);
  assert(sessionValid(token, config, config.origin, now));
  assert(!sessionValid(token, config, config.origin, now + SESSION_SECONDS * 1000));
  assert(!sessionValid(token, config, "http://localhost:3000", now));
  assert(!sessionValid(token + ".extra", config, config.origin, now));
  assert(!sessionValid("x" + token, config, config.origin, now));
  assert(!sessionValid(token, createWebConfig(config.origin, "synthetic-passphrase-123"), config.origin, now));
  assert(!sessionValid(undefined, config, config.origin));
});
test("return path never redirects to another origin or loops to login", () => {
  for (const path of ["//evil.test", "/\\evil.test", "https://evil.test", "/entrar?next=x", "/\r\nLocation:evil", null]) assert.equal(safeReturnPath(path), "/");
  assert.equal(safeReturnPath("/vagas?filter=remote"), "/vagas?filter=remote");
});

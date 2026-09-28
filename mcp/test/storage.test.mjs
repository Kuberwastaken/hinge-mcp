import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { configFromEnv } from "../dist/config.js";
import { FileStorage } from "../dist/storage.js";

test("file storage round trips and creates directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hinge-mcp-storage-"));
  const storage = new FileStorage(dir);
  assert.equal(await storage.exists("nested/session.json"), false);
  assert.equal(await storage.readText("nested/session.json"), undefined);
  await storage.writeText("nested/session.json", "{}");
  assert.equal(await storage.exists("nested/session.json"), true);
  assert.equal(await storage.readText("nested/session.json"), "{}");
  const mode = (await stat(join(dir, "nested/session.json"))).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
  await storage.remove("nested/session.json");
  assert.equal(await storage.exists("nested/session.json"), false);
});

test("file storage uses absolute keys as-is", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hinge-mcp-storage-"));
  const storage = new FileStorage("/nonexistent-base");
  const path = join(dir, "abs.json");
  await storage.writeText(path, "x");
  assert.equal(await storage.readText(path), "x");
});

test("config reads env and http flags", () => {
  const config = configFromEnv({ HINGE_SESSION_FILE: "/tmp/x/session.json", HINGE_MCP_READ_ONLY: "true", HINGE_MCP_TOKEN: " tok " }, ["--http", "4444"]);
  assert.equal(config.sessionFile, resolve("/tmp/x/session.json"));
  assert.equal(config.cacheDir, resolve("/tmp/x"));
  assert.equal(config.readOnly, true);
  assert.equal(config.allowRaw, false);
  assert.equal(config.http, true);
  assert.equal(config.port, 4444);
  assert.equal(config.token, "tok");
  assert.equal(config.host, "127.0.0.1");
  const defaults = configFromEnv({}, []);
  assert.equal(defaults.http, false);
  assert.equal(defaults.port, 3939);
  assert.match(defaults.sessionFile, /\.hinge-mcp[\\/]session\.json$/);
});

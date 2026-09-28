import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createOAuthVerifier } from "../dist/oauth.js";
import { startHttpServer, createHttpHandler } from "../dist/http.js";
import { NodeHingeTransport, operationSignal } from "../dist/transport.js";
import { configFromEnv } from "../dist/config.js";
import { jsonResult } from "../dist/result.js";
import { makeContext, connect, MockTransport } from "./helpers.mjs";

test("HTTP validates Host, Origin, credentials, body bounds and methods", async (t) => {
  const { context } = await makeContext({
    env: { HINGE_MCP_PORT: "0", HINGE_MCP_TOKEN: "test-token" },
  });
  const http = await startHttpServer(context);
  t.after(() => http.close());
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(
      http.url,
      { method: "POST", headers: { ...headers, host: "attacker.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
  assert.equal(hostStatus, 403);
  assert.equal(
    (
      await fetch(http.url, {
        method: "POST",
        headers: { ...headers, origin: "https://attacker.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(http.url, {
        method: "OPTIONS",
        headers: { origin: new URL(http.url).origin },
      })
    ).status,
    204,
  );
  for (const method of ["GET", "DELETE", "PUT"])
    assert.equal((await fetch(http.url, { method, headers })).status, 405);
  assert.equal(
    (await fetch(http.url, { method: "POST", headers, body: "{" })).status,
    400,
  );
  assert.equal(
    (
      await fetch(http.url, {
        method: "POST",
        headers,
        body: '{"x":"' + "a".repeat(1024 * 1024) + '"}',
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await fetch(http.url, {
        method: "POST",
        headers: { ...headers, accept: "text/plain" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    ).status,
    406,
  );
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "wire", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const mismatch = await fetch(http.url, {
    method: "POST",
    headers: {
      ...headers,
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: { _meta: meta },
    }),
  });
  assert.equal(mismatch.status, 400);
  for (const version of [
    "2024-11-05",
    "2025-03-26",
    "2025-06-18",
    "2025-11-25",
  ]) {
    const response = await fetch(http.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: version,
          clientInfo: { name: "wire", version: "1" },
          capabilities: {},
        },
      }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(version), text);
  }
});

test("public HTTP fails closed without authentication; OAuth metadata is discoverable", async (t) => {
  const { context } = await makeContext({ env: { HINGE_MCP_HOST: "0.0.0.0" } });
  assert.throws(() => createHttpHandler(context), /requires/);
  const oauth = {
    HINGE_MCP_PORT: "0",
    HINGE_MCP_PUBLIC_URL: "https://hinge.example/mcp",
    HINGE_MCP_OAUTH_ISSUER: "https://auth.example/",
    HINGE_MCP_OAUTH_JWKS_URL: "https://auth.example/jwks",
    HINGE_MCP_OAUTH_SUBJECT: "owner",
  };
  const configured = await makeContext({ env: oauth });
  assert.equal(configured.context.config.oauth.issuer, "https://auth.example/");
  const http = await startHttpServer(configured.context);
  t.after(() => http.close());
  const meta = await fetch(
    http.url.replace("/mcp", "/.well-known/oauth-protected-resource/mcp"),
  );
  assert.equal(meta.status, 200);
  const doc = await meta.json();
  assert.deepEqual(doc, {
    resource: "https://hinge.example/mcp",
    authorization_servers: ["https://auth.example/"],
    scopes_supported: ["hinge:access"],
    bearer_methods_supported: ["header"],
  });
  const denied = await fetch(http.url, { method: "POST" });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate"), /resource_metadata=/);
});

test("OAuth validates signature, issuer, audience, expiry, owner subject and scope", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const config = {
    issuer: "https://auth.example/",
    audience: "https://hinge.example/mcp",
    subject: "owner",
    scope: "hinge:access",
    jwksUrl: "https://auth.example/jwks",
  };
  const verify = createOAuthVerifier(
    config,
    createLocalJWKSet({ keys: [jwk] }),
  );
  const sign = (overrides = {}) =>
    new SignJWT({
      iss: config.issuer,
      aud: config.audience,
      sub: config.subject,
      scope: config.scope,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(privateKey);
  assert.equal(await verify(await sign()), "ok");
  for (const fields of [
    { iss: "https://evil.example" },
    { aud: "other-resource" },
    { sub: "other-account" },
    { exp: 1 },
  ])
    assert.equal(await verify(await sign(fields)), "invalid_token");
  assert.equal(
    await verify(await sign({ scope: "unrelated" })),
    "insufficient_scope",
  );
  assert.equal(
    await verify((await sign()).slice(0, -10) + "corrupted"),
    "invalid_token",
  );
});

test("upstream transport blocks credential exfiltration and redirects and observes cancellation", async () => {
  let requests = 0;
  const request = {
    service: "hinge",
    method: "GET",
    url: "https://api.example/ok",
    pathOrUrl: "/ok",
    headers: { authorization: "secret" },
  };
  const transport = new NodeHingeTransport(
    { hinge: "https://api.example", sendbird: "https://chat.example" },
    1000,
    false,
    async (url, init) => {
      requests++;
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      return new Response('{"ok":true}');
    },
  );
  await assert.rejects(
    transport.request({ ...request, url: "https://evil.example/" }),
    /outside/,
  );
  await assert.rejects(
    transport.request({ ...request, url: "https://user:secret@api.example/" }),
    /outside/,
  );
  assert.equal(requests, 0);
  assert.deepEqual((await transport.request(request)).body, { ok: true });
  await assert.rejects(
    operationSignal.run(AbortSignal.abort(), () => transport.request(request)),
    { name: "AbortError" },
  );
  assert.equal(requests, 1);
  const huge = new NodeHingeTransport(
    { hinge: "https://api.example", sendbird: "https://chat.example" },
    1000,
    false,
    async () => new Response("a".repeat(4 * 1024 * 1024 + 1)),
  );
  await assert.rejects(huge.request(request), /4 MiB/);
});

test("strict schemas reject bad input before upstream access and raw cannot escape hosts", async (t) => {
  const { context, transport } = await makeContext({
    env: { HINGE_MCP_ALLOW_RAW: "1" },
  });
  const session = await connect(context);
  t.after(() => session.close());
  for (const [name, args] of [
    ["hinge_profiles", { userIds: ["1002&admin=true"] }],
    ["hinge_login_verify_otp", { otp: "letters" }],
    ["hinge_like", { subjectId: "1002", ratingToken: "t", unknown: true }],
    [
      "hinge_raw_request",
      { service: "hinge", method: "GET", path: "https://evil.example" },
    ],
    [
      "hinge_raw_request",
      { service: "hinge", method: "GET", path: "//evil.example" },
    ],
  ]) {
    const result = await session.call(name, args);
    assert.equal(result.isError, true, name);
  }
  assert.equal(transport.requests.length, 0);
  const invalid = await session.call("fetch", { id: "unknown:1002" });
  assert.equal(invalid.isError, true);
  assert.equal(transport.requests.length, 0);
});

test("read-only chat lookup never creates a channel; search failures stay errors", async (t) => {
  const transport = new MockTransport()
    .on("GET", /my_group_channels/, () => ({ body: { channels: [] } }))
    .on("GET", "/connection/v2", () => ({
      status: 401,
      body: { token: "private-response" },
    }));
  const { context } = await makeContext({
    env: { HINGE_MCP_READ_ONLY: "1", HINGE_MCP_ALLOW_RAW: "1" },
    transport,
  });
  const session = await connect(context);
  t.after(() => session.close());
  const result = await session.call("hinge_chat_messages", {
    partnerUserId: "1002",
  });
  assert.equal(result.isError, true);
  assert.equal(
    transport.requests.some((r) => r.method !== "GET"),
    false,
  );
  const search = await session.call("search", { query: "matches" });
  assert.equal(search.isError, true);
  assert.doesNotMatch(search.text, /private-response/);
  const names = await session.toolNames();
  assert.equal(names.includes("hinge_raw_request"), false);
});

test("operation queue is bounded, cancels waiting work and serializes logout", async () => {
  const { context } = await makeContext();
  let release;
  const blocked = context.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const pending = Array.from({ length: 31 }, () => context.run(async () => 1));
  await assert.rejects(
    context.run(async () => 1),
    /queue is full/,
  );
  release();
  await Promise.all([blocked, ...pending]);
  let called = false;
  await assert.rejects(
    context.run(async () => {
      called = true;
    }, AbortSignal.abort()),
    { name: "AbortError" },
  );
  assert.equal(called, false);
  const order = [];
  await Promise.all([
    context.run(async () => {
      order.push(1);
      await context.saveSession();
    }),
    context.run(async () => {
      await context.clearSession();
      order.push(2);
    }),
  ]);
  assert.deepEqual(order, [1, 2]);
  assert.equal(await context.storage.exists(context.config.sessionFile), false);
});

test("results redact credentials, preserve rating tokens and bound output size", () => {
  const result = jsonResult({
    token: "private",
    nested: { access_token: "private" },
    ratingToken: "needed",
  });
  assert.doesNotMatch(result.content[0].text, /private/);
  assert.equal(result.structuredContent.ratingToken, "needed");
  assert.throws(() => jsonResult({ huge: "a".repeat(128 * 1024) }), /128 KiB/);
});

test("invalid configuration fails with actionable errors", () => {
  for (const env of [
    { HINGE_MCP_PORT: "1.5" },
    { HINGE_MCP_PORT: "65536" },
    { HINGE_PHONE_NUMBER: "123" },
    { HINGE_MCP_READ_ONLY: "maybe" },
    { HINGE_MCP_OAUTH_ISSUER: "https://auth.example" },
    { HINGE_MCP_PUBLIC_URL: "http://remote.example/mcp" },
    { HINGE_MCP_ALLOWED_ORIGINS: "*" },
  ])
    assert.throws(() => configFromEnv(env, []));
  assert.throws(() => configFromEnv({}, ["--unknown"]), /Unknown argument/);
  assert.throws(() => configFromEnv({}, ["--http", "oops"]), /integer/);
});

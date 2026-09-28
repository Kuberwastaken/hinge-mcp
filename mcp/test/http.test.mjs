import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../dist/http.js";
import { makeContext, MockTransport } from "./helpers.mjs";

async function startServer(env = {}) {
  const transport = new MockTransport().on("GET", "/likelimit", () => ({ body: { likes: 8 } }));
  const { context } = await makeContext({ transport, env: { HINGE_MCP_PORT: "0", ...env } });
  context.config.port = 0;
  const http = await startHttpServer(context);
  return { http, context };
}

test("http transport serves health and rejects missing bearer tokens", async () => {
  const { http } = await startServer({ HINGE_MCP_TOKEN: "secret" });
  try {
    const health = await fetch(http.url.replace("/mcp", "/healthz"));
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const missing = await fetch(http.url.replace("/mcp", "/nope"));
    assert.equal(missing.status, 404);

    const unauthorized = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const wrong = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(wrong.status, 401);
  } finally {
    await http.close();
  }
});

test("http transport runs mcp sessions with a valid bearer token", async () => {
  const { http } = await startServer({ HINGE_MCP_TOKEN: "secret" });
  const client = new Client({ name: "http-test", version: "0.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { authorization: "Bearer secret" } } }));
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "search"));
    const limit = await client.callTool({ name: "hinge_like_limit", arguments: {} });
    assert.deepEqual(JSON.parse(limit.content[0].text), { likes: 8 });
  } finally {
    await client.close().catch(() => undefined);
    await http.close();
  }
});

test("http transport accepts the token as a path segment", async () => {
  const { http } = await startServer({ HINGE_MCP_TOKEN: "secret" });
  const client = new Client({ name: "http-test", version: "0.0.0" });
  try {
    const wrong = await fetch(`${http.url}/nope`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(wrong.status, 401);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${http.url}/secret`)));
    assert.ok((await client.listTools()).tools.length > 0);
  } finally {
    await client.close().catch(() => undefined);
    await http.close();
  }
});

test("path tokens are not routable when no token is configured", async () => {
  const { http } = await startServer();
  try {
    const response = await fetch(`${http.url}/anything`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(response.status, 404);
  } finally {
    await http.close();
  }
});

test("http transport works without a token on loopback", async () => {
  const { http } = await startServer();
  const client = new Client({ name: "http-test", version: "0.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
    assert.ok((await client.listTools()).tools.length > 0);
  } finally {
    await client.close().catch(() => undefined);
    await http.close();
  }
});

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { HingeMcpContext } from "./client.js";
import { createHingeMcpServer } from "./server.js";
import { isLoopback } from "./config.js";
import { createOAuthVerifier } from "./oauth.js";

export const MCP_PATH = "/mcp";
export function createHttpHandler(context: HingeMcpContext) {
  const { config } = context;
  if ((!isLoopback(config.host) || config.publicUrl) && !config.token && !config.oauth) throw new Error("Non-loopback/public HTTP requires HINGE_MCP_TOKEN or OAuth configuration");
  const mcp = createMcpHandler(() => createHingeMcpServer(context), { legacy: "stateless", responseMode: "auto", maxRequestBodySize: 1024 * 1024, maxSubscriptions: 0 });
  const nodeHandler = toNodeHandler(mcp, { maxRequestBodySize: 1024 * 1024 });
  const verify = config.oauth ? createOAuthVerifier(config.oauth) : undefined;
  const publicUrl = config.publicUrl ? new URL(config.publicUrl) : undefined;
  const metadataUrl = publicUrl ? `${publicUrl.origin}/.well-known/oauth-protected-resource/mcp` : undefined;
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    try {
      const host = req.headers.host ?? "";
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
      if (!local && host.toLowerCase() !== publicUrl?.host.toLowerCase()) { json(res, 403, { error: "Host not allowed" }); return; }
      const origin = req.headers.origin;
      const allowedOrigins = new Set([...config.origins, ...(publicUrl ? [publicUrl.origin] : []), ...(local ? [`http://${host}`] : [])]);
      if (origin && !allowedOrigins.has(origin)) { json(res, 403, { error: "Origin not allowed" }); return; }
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-expose-headers", "WWW-Authenticate, MCP-Protocol-Version");
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz" && req.method === "GET") { json(res, 200, { ok: true, name: "hinge-mcp" }); return; }
      if (config.oauth && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname) && req.method === "GET") {
        json(res, 200, { resource: config.oauth.audience, authorization_servers: [config.oauth.issuer], scopes_supported: [config.oauth.scope], bearer_methods_supported: ["header"] }); return;
      }
      if (url.pathname !== MCP_PATH) { json(res, 404, { error: "not found" }); return; }
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name", "access-control-max-age": "600" }); res.end(); return;
      }
      const bearer = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (verify && config.oauth) {
        const status = bearer ? await verify(bearer) : "invalid_token";
        if (status !== "ok") {
          res.setHeader("www-authenticate", `Bearer resource_metadata="${metadataUrl}", scope="${config.oauth.scope}", error="${status}"`);
          json(res, status === "insufficient_scope" ? 403 : 401, { error: status }); return;
        }
      } else if (config.token) {
        const expected = Buffer.from(config.token), supplied = Buffer.from(bearer ?? "");
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
          res.setHeader("www-authenticate", "Bearer"); json(res, 401, { error: "unauthorized" }); return;
        }
      }
      if (["GET", "DELETE"].includes(req.method ?? "")) { res.setHeader("allow", "POST, OPTIONS"); json(res, 405, { error: "Stateless MCP uses POST; no session or standalone SSE stream" }); return; }
      await nodeHandler(req, res);
    } catch {
      if (!res.headersSent) json(res, 500, { error: "internal error" }); else res.end();
    }
  };
  return Object.assign(handler, { close: () => mcp.close() });
}
export async function startHttpServer(context: HingeMcpContext): Promise<{ close(): Promise<void>; url: string }> {
  const handler = createHttpHandler(context);
  const server = createServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(context.config.port, context.config.host, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : context.config.port;
  const host = context.config.host.includes(":") ? `[${context.config.host}]` : context.config.host;
  const url = `http://${host}:${port}${MCP_PATH}`;
  process.stderr.write(`hinge-mcp listening on ${url}\n`);
  return { url, close: async () => {
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

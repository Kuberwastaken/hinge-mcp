import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { HingeMcpContext } from "./client.js";
import { createHingeMcpServer } from "./server.js";

export const MCP_PATH = "/mcp";

/**
 * Streamable HTTP front door for remote clients such as ChatGPT connectors.
 * Runs stateless: every request gets a fresh transport bound to a fresh
 * McpServer over the shared Hinge context. The user exposes this through their
 * own tunnel; nothing here is hosted for them.
 */
export function createHttpHandler(context: HingeMcpContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const token = context.config.token;
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz" || url.pathname === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "hinge-mcp", mcp: MCP_PATH }));
      return;
    }
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (token && !isAuthorized(req, token)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createHingeMcpServer(context);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      context.client.logger?.error?.("http request failed", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  };
}

export async function startHttpServer(context: HingeMcpContext): Promise<{ close(): Promise<void>; url: string }> {
  const { host, port, token } = context.config;
  if (!token && !isLoopback(host)) {
    process.stderr.write("hinge-mcp: HINGE_MCP_TOKEN is not set while binding a non-loopback host; anyone who can reach this port can drive the account\n");
  }
  const handler = createHttpHandler(context);
  const httpServer = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });
  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}${MCP_PATH}`;
  process.stderr.write(`hinge-mcp listening on ${url}${token ? " (bearer token required)" : ""}\n`);
  return {
    url,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())))
  };
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return false;
  const provided = Buffer.from(match[1].trim());
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

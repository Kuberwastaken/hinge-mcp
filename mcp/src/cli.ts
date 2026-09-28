#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHingeContext, stderrLogger } from "./client.js";
import { configFromEnv } from "./config.js";
import { createHingeMcpServer } from "./server.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  const config = configFromEnv(process.env, argv);
  const context = createHingeContext(config, stderrLogger(config.debug));
  await context.loadSession();
  if (config.http) {
    const { startHttpServer } = await import("./http.js");
    await startHttpServer(context);
    return;
  }
  const server = createHingeMcpServer(context);
  await server.connect(new StdioServerTransport());
}

function usage(): string {
  return `hinge-mcp: MCP server for the hinge-ts SDK

Usage:
  hinge-mcp                 stdio transport (Claude Desktop, Claude Code)
  hinge-mcp --http [port]   Streamable HTTP on http://HOST:PORT/mcp (ChatGPT via a tunnel)
                            with HINGE_MCP_TOKEN set, /mcp/<token> also works

Environment:
  HINGE_PHONE_NUMBER    E.164 phone number for login (or pass it to hinge_login_start)
  HINGE_SESSION_FILE    session file path (default ~/.hinge-mcp/session.json)
  HINGE_MCP_READ_ONLY   1 to hide tools that like, skip, message, or change settings
  HINGE_MCP_ALLOW_RAW   1 to expose hinge_raw_request
  HINGE_MCP_TOKEN       bearer token required by the HTTP transport
  HINGE_MCP_HOST        HTTP bind host (default 127.0.0.1)
  HINGE_MCP_PORT        HTTP port (default 3939)
  HINGE_MCP_DEBUG       1 to log redacted requests to stderr
`;
}

main().catch((error) => {
  process.stderr.write(`hinge-mcp failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

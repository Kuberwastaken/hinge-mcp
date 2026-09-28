#!/usr/bin/env node
import {
  serveStdio,
  StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";
import { createHingeContext, stderrLogger } from "./client.js";
import { configFromEnv } from "./config.js";
import { createHingeMcpServer, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "hinge-mcp [--http [port]]\n\nDefault: stdio. HTTP: http://127.0.0.1:3939/mcp\nConfiguration and client setup: https://github.com/Kuberwastaken/hinge-mcp#readme\n",
    );
    return;
  }
  if (argv.includes("--version")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  const config = configFromEnv(process.env, argv);
  const context = createHingeContext(config, stderrLogger(config.debug));
  await context.loadSession();
  const handle = config.http
    ? await (await import("./http.js")).startHttpServer(context)
    : serveStdio(() => createHingeMcpServer(context), {
        transport: new StdioServerTransport(process.stdin, process.stdout, {
          maxBufferSize: 1024 * 1024,
        }),
        maxSubscriptions: 0,
      });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void handle.close().then(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
main().catch((error) => {
  process.stderr.write(
    `hinge-mcp failed: ${error instanceof Error ? error.message : "startup error"}\n`,
  );
  process.exitCode = 1;
});

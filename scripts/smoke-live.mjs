import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

if (!process.env.HINGE_SESSION_FILE)
  throw new Error(
    "Set HINGE_SESSION_FILE to an existing local session. This smoke test never logs in or changes the account.",
  );
const client = new Client(
  { name: "hinge-live-smoke", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../mcp/dist/cli.js", import.meta.url))],
      env: {
        ...process.env,
        HINGE_MCP_HTTP: "0",
        HINGE_MCP_READ_ONLY: "1",
        HINGE_MCP_ALLOW_RAW: "0",
        HINGE_MCP_DEBUG: "0",
      },
      stderr: "inherit",
    }),
  );
  for (const name of ["hinge_session_status", "hinge_me"]) {
    const result = await client.callTool({ name, arguments: {} });
    if (result.isError)
      throw new Error(`${name} failed: ${result.content[0]?.text}`);
    if (name === "hinge_session_status" && !result.structuredContent.loggedIn)
      throw new Error(
        "Session is absent or locally expired; log in through your MCP host first",
      );
    process.stdout.write(`${name}: passed (account data omitted)\n`);
  }
} finally {
  await client.close();
}

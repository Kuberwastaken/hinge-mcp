# MCP Server

`mcp/` contains `hinge-mcp`, an MCP server that exposes this SDK to Claude
Desktop, Claude Code, ChatGPT, and other MCP clients. It runs locally on your
machine and stores the Hinge session in `~/.hinge-mcp/session.json`.

Full setup, environment variables, client configuration, and the tool list live
in [mcp/README.md](../mcp/README.md).

Quick start:

```bash
npm install && npm run build
cd mcp && npm install && npm run build
HINGE_PHONE_NUMBER=+15555550123 node dist/cli.js
```

- stdio (default) for Claude Desktop and Claude Code
- `--http` for ChatGPT connectors through a tunnel you run, protected by
  `HINGE_MCP_TOKEN`
- `HINGE_MCP_READ_ONLY=1` for a server that can only read

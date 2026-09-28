# MCP Server

`mcp/` contains `hinge-mcp`, an MCP server that exposes this SDK to Claude
Desktop, Claude Code, ChatGPT, and other MCP clients. It runs locally on your
machine and stores the Hinge session in `~/.hinge-mcp/session.json`.

Full setup, environment variables, client configuration, and the tool list live
in the maintained [repository README](../../README.md).

Quick start:

```bash
npm ci
npm run build
node mcp/dist/cli.js
```

- stdio (default) for Claude Desktop and Claude Code
- `--http` for Streamable HTTP; see the root README for OAuth and bearer setup
- `HINGE_MCP_READ_ONLY=1` hides account writes while retaining login/logout

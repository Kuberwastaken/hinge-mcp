# hinge-mcp

MCP server built on [wrsrsh/hinge-ts](https://github.com/wrsrsh/hinge-ts).

This repository preserves upstream history through `7f1b425`. The MIT licensed
SDK lives in `sdk/`; the server lives in `mcp/`. Both build from one npm workspace.

```sh
npm ci
npm run build
npm test
npm start
```

Requires Node.js 22 or newer. See [server documentation](mcp/README.md) and
[SDK documentation](sdk/README.md). This is an unofficial project, unaffiliated
with Hinge, Match Group, or Sendbird.

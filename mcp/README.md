# hinge-mcp

MCP server that exposes the [hinge-ts](https://github.com/wrsrsh/hinge-ts) SDK
to Claude Desktop, Claude Code, ChatGPT, and any other MCP client. It runs on
your own machine. Nothing is hosted for you, and your Hinge session never
leaves the session file on your disk.

This project is unofficial and is not affiliated with Hinge, Match Group,
Sendbird, Anthropic, or OpenAI. Automating a dating account may violate Hinge's
terms; use your own account and your own judgement.

## Requirements

- Node 20 or newer
- A Hinge account that can receive SMS codes

## Install

From this repository:

```bash
npm install
npm run build
cd mcp
npm install
npm run build
```

The server binary is `mcp/dist/cli.js` (also exposed as the `hinge-mcp` bin).
Run `node mcp/dist/cli.js --help` to see the flags.

## How it works

- Talks to Hinge and Sendbird directly from Node with `BrowserFetchTransport`.
- Stores the session at `~/.hinge-mcp/session.json` (mode 600) and reloads it
  on start. Override the path with `HINGE_SESSION_FILE`.
- Login happens through tools: `hinge_login_start` sends the SMS code,
  `hinge_login_verify_otp` submits it, and `hinge_login_verify_email` handles
  Hinge's email verification when it is required.
- Realtime WebSocket features (typing indicators, read receipts) are not
  exposed. Everything runs over REST.

## Transports

| Mode | Command | Use for |
| --- | --- | --- |
| stdio (default) | `hinge-mcp` | Claude Desktop, Claude Code, Cursor, and other local clients |
| Streamable HTTP | `hinge-mcp --http [port]` | ChatGPT connectors and remote clients, through a tunnel you run |

The HTTP mode listens on `http://127.0.0.1:3939/mcp` by default and serves
`/healthz` for liveness checks. It is stateless, so it works behind any tunnel.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HINGE_PHONE_NUMBER` | unset | E.164 phone number used by `hinge_login_start` when no number is passed |
| `HINGE_SESSION_FILE` | `~/.hinge-mcp/session.json` | Where the session and caches live |
| `HINGE_MCP_READ_ONLY` | `0` | `1` hides every tool that likes, skips, messages, or changes settings |
| `HINGE_MCP_ALLOW_RAW` | `0` | `1` exposes `hinge_raw_request` |
| `HINGE_MCP_TOKEN` | unset | Bearer token required by the HTTP transport (also accepted as `/mcp/<token>`) |
| `HINGE_MCP_HOST` | `127.0.0.1` | HTTP bind host |
| `HINGE_MCP_PORT` | `3939` | HTTP port (`--http <port>` overrides it) |
| `HINGE_MCP_DEBUG` | `0` | `1` logs redacted requests to stderr |

## Claude Desktop

Add the server to `claude_desktop_config.json` (Settings, Developer, Edit
Config):

```json
{
  "mcpServers": {
    "hinge": {
      "command": "node",
      "args": ["/absolute/path/to/hinge-ts/mcp/dist/cli.js"],
      "env": {
        "HINGE_PHONE_NUMBER": "+15555550123"
      }
    }
  }
}
```

Restart Claude Desktop, then ask Claude to run `hinge_session_status`. If it
reports that login is needed, ask it to start login; it will request the SMS
code from you.

## Claude Code

```bash
claude mcp add hinge --env HINGE_PHONE_NUMBER=+15555550123 -- node /absolute/path/to/hinge-ts/mcp/dist/cli.js
```

Or add it to `.mcp.json` in a project:

```json
{
  "mcpServers": {
    "hinge": {
      "command": "node",
      "args": ["/absolute/path/to/hinge-ts/mcp/dist/cli.js"],
      "env": { "HINGE_PHONE_NUMBER": "+15555550123" }
    }
  }
}
```

## ChatGPT

ChatGPT connects to MCP servers over HTTPS, so run the HTTP mode locally and
expose it with a tunnel you control. Nothing is deployed anywhere.

1. Start the server with a token:

   ```bash
   HINGE_MCP_TOKEN="$(openssl rand -hex 24)" HINGE_PHONE_NUMBER=+15555550123 node mcp/dist/cli.js --http 3939
   ```

2. Open a tunnel to the port, for example:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:3939
   ```

   or `ngrok http 3939`. Note the public `https://` URL.

3. In ChatGPT, open Settings, then Connectors. Enable Developer mode under
   Advanced if it is not on, then choose Create.
4. Set the MCP server URL to `https://<your-tunnel-host>/mcp/<token>` and pick
   "No authentication". The token in the path is what protects the endpoint,
   so treat the URL as a secret. Clients that can send headers may use
   `https://<your-tunnel-host>/mcp` with `Authorization: Bearer <token>`
   instead.
5. Save, then enable the connector in a chat (Deep research and Developer
   mode chats can use it). ChatGPT will discover the `search` and `fetch`
   tools it expects along with the `hinge_*` tools.

Stop the tunnel when you are done. Anyone with the URL can drive your account
while it is up.

## Tools

Session

| Tool | What it does |
| --- | --- |
| `hinge_session_status` | Reports whether a valid session is loaded and what to do next |
| `hinge_login_start` | Sends the SMS code (uses `HINGE_PHONE_NUMBER` or `phoneNumber`) |
| `hinge_login_verify_otp` | Submits the SMS code; returns a `caseId` when email verification is required |
| `hinge_login_verify_email` | Completes email verification with the `caseId` and emailed code |
| `hinge_logout` | Deletes the local session file |

Read

| Tool | What it does |
| --- | --- |
| `hinge_me` | Own profile and content |
| `hinge_profiles` | Compact summaries for a list of user ids |
| `hinge_preferences` | Dating preferences |
| `hinge_recommendations` | Discover feed with `subjectId` and `ratingToken` per person, profiles attached |
| `hinge_standouts` | Standouts feed |
| `hinge_like_limit` | Remaining likes and roses |
| `hinge_likes_received` | People who liked you, with rating tokens |
| `hinge_matches` | Current matches |
| `hinge_match_detail` | Connection detail, match note, profile |
| `hinge_chats` | Chat channels with partner, unread count, last message |
| `hinge_chat_messages` | Messages in a channel (by `channelUrl` or `partnerUserId`) |
| `hinge_prompts_search` | Search the Hinge prompt catalog |

Write (hidden when `HINGE_MCP_READ_ONLY=1`)

| Tool | What it does |
| --- | --- |
| `hinge_like` | Like a profile, optionally with a comment on a prompt or photo, optionally spending a rose |
| `hinge_skip` | Pass on a profile |
| `hinge_send_message` | Send a text message to a match |
| `hinge_update_preferences` | Merge changes into dating preferences |
| `hinge_raw_request` | Authenticated raw Hinge or Sendbird request (needs `HINGE_MCP_ALLOW_RAW=1`) |

ChatGPT connector contract

| Tool | What it does |
| --- | --- |
| `search` | Searches matches, received likes, recommendations, or chats and returns ids |
| `fetch` | Returns a full profile or chat transcript for a `search` id |

Write tools carry `readOnlyHint: false` annotations, so clients can ask for
confirmation before running them. The server instructions also tell the model
to confirm likes, skips, and messages with you first.

## Development

```bash
cd mcp
npm run typecheck
npm test
```

Tests run the server over the in-memory MCP transport and over real HTTP
against a mocked Hinge backend. No network access is needed.

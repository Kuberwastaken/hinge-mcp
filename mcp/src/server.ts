import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HingeMcpContext } from "./client.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerReadTools } from "./tools/read.js";

export const SERVER_NAME = "hinge-mcp";
export const SERVER_VERSION = "0.1.0";

export type ToolModule = (server: McpServer, context: HingeMcpContext) => void;

const modules: ToolModule[] = [registerAuthTools, registerReadTools];

export function createHingeMcpServer(context: HingeMcpContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        "Tools for operating the user's own Hinge account through the hinge-ts SDK.",
        "Most tools need a logged-in session. If a tool reports a missing or expired session, run hinge_login_start, then hinge_login_verify_otp with the SMS code (and hinge_login_verify_email if Hinge asks for email verification).",
        "Recommendation and like entries carry a subjectId and ratingToken; pass both to hinge_like or hinge_skip.",
        "Actions that like, skip, message, or change settings are irreversible on the real account. Confirm intent with the user before calling them."
      ].join("\n")
    }
  );
  for (const register of modules) {
    register(server, context);
  }
  return server;
}

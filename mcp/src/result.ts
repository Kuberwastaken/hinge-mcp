import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { Email2FAError, HingeError } from "hinge-ts";
import type { HingeMcpContext } from "./client.js";

export function jsonResult(value: unknown, structured?: Record<string, unknown>): CallToolResult {
  const data = redact(value ?? null);
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
    structuredContent: structured ?? (typeof data === "object" && !Array.isArray(data) && data !== null ? data as Record<string, unknown> : { data })
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(token|access_?token|refresh_?token|authorization|password|session_?key|sendbirdSessionKey|hingeAuthToken|sendbirdAuthToken)$/i.test(key) ? "[REDACTED]" : redact(item)]));
  return value;
}
export function textResult(text: string): CallToolResult { return { content: [{ type: "text", text }] }; }
export function errorResult(error: unknown): CallToolResult { return { isError: true, content: [{ type: "text", text: describeError(error) }] }; }
export function describeError(error: unknown): string {
  if (error instanceof Email2FAError) return "Email verification required; use hinge_login_verify_email.";
  if (error instanceof HingeError) {
    if (error.status === 401 || error.kind === "auth") return "Hinge session missing or expired; run hinge_login_start and hinge_login_verify_otp.";
    if (error.status === 429) return "Hinge rate limit reached. Wait before retrying; no automatic retry was made.";
    return `Hinge request failed${error.status ? ` (HTTP ${error.status})` : ""}. No upstream response body was exposed.`;
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "Request cancelled or timed out. A write may already have reached Hinge; check state before retrying.";
  return error instanceof Error ? error.message : "Operation failed";
}
export function guarded<Args>(context: HingeMcpContext, handler: (args: Args) => Promise<CallToolResult>): (args: Args, ctx: ServerContext) => Promise<CallToolResult> {
  return async (args, ctx) => {
    try { return await context.run(() => handler(args), ctx.mcpReq.signal); }
    catch (error) { return errorResult(error); }
  };
}

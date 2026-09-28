import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Email2FAError, HingeError } from "hinge-ts";

export function jsonResult(value: unknown, structured?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2) }]
  };
  if (structured) {
    result.structuredContent = structured;
  }
  return result;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: describeError(error) }]
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Email2FAError) {
    return `Email verification required. Case id: ${error.caseId}. A code was sent to ${error.email}. Call hinge_login_verify_email with the case id and the code.`;
  }
  if (error instanceof HingeError) {
    if (error.status === 401 || error.kind === "auth") {
      return `${error.message}. The Hinge session is missing or expired; run hinge_login_start and hinge_login_verify_otp.`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Wraps a tool handler so thrown errors become MCP error results instead of protocol failures. */
export function guarded<Args>(handler: (args: Args) => Promise<CallToolResult>): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

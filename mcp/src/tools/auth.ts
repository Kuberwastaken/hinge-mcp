import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Email2FAError } from "hinge-ts";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export function registerAuthTools(server: McpServer, context: HingeMcpContext): void {
  const { client } = context;

  server.registerTool(
    "hinge_session_status",
    {
      title: "Hinge session status",
      description: "Reports whether a Hinge session is loaded and still valid, which phone number it belongs to, and where it is stored. Call this first when unsure whether login is needed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    guarded(async () => {
      const hasToken = Boolean(client.hingeAuth?.token);
      let valid = false;
      let error: string | undefined;
      if (hasToken) {
        try {
          valid = await client.auth.isSessionValid();
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
      }
      return jsonResult({
        loggedIn: valid,
        hasStoredToken: hasToken,
        phoneNumber: context.hasPhoneNumber() ? client.phoneNumber : null,
        identityId: client.hingeAuth?.identityId ?? null,
        hingeTokenExpires: client.hingeAuth?.expires ?? null,
        sessionFile: context.config.sessionFile,
        readOnly: context.config.readOnly,
        nextStep: valid ? "ready" : "call hinge_login_start, then hinge_login_verify_otp",
        ...(error ? { error } : {})
      });
    })
  );

  server.registerTool(
    "hinge_login_start",
    {
      title: "Start Hinge login",
      description: "Sends a Hinge SMS one-time code to the phone number. Uses HINGE_PHONE_NUMBER unless phoneNumber is given (E.164, e.g. +15555550123). Follow up with hinge_login_verify_otp.",
      inputSchema: {
        phoneNumber: z.string().regex(PHONE_PATTERN, "use E.164 format like +15555550123").optional().describe("Phone number in E.164 format. Optional when HINGE_PHONE_NUMBER is set.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    guarded(async ({ phoneNumber }) => {
      if (phoneNumber) {
        client.phoneNumber = phoneNumber;
      }
      if (!context.hasPhoneNumber()) {
        throw new Error("No phone number configured. Pass phoneNumber or set HINGE_PHONE_NUMBER.");
      }
      await client.auth.initiateSms();
      await context.saveSession();
      return jsonResult({
        status: "otp_sent",
        phoneNumber: client.phoneNumber,
        nextStep: "ask the user for the SMS code, then call hinge_login_verify_otp"
      });
    })
  );

  server.registerTool(
    "hinge_login_verify_otp",
    {
      title: "Verify Hinge SMS code",
      description: "Submits the SMS one-time code from hinge_login_start. On success the session is saved. If Hinge requires email verification, the result contains a caseId and the email address; ask the user for the emailed code and call hinge_login_verify_email.",
      inputSchema: {
        otp: z.string().min(4).max(10).describe("The numeric code from the SMS")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    guarded(async ({ otp }) => {
      try {
        await client.auth.submitOtp(otp.trim());
      } catch (error) {
        if (error instanceof Email2FAError) {
          await context.saveSession();
          return jsonResult({
            status: "email_verification_required",
            caseId: error.caseId,
            email: error.email,
            nextStep: "ask the user for the code emailed to them, then call hinge_login_verify_email with caseId and code"
          });
        }
        throw error;
      }
      await client.ensureSendbirdAuth().catch(() => undefined);
      await context.saveSession();
      return jsonResult(loginSummary(context));
    })
  );

  server.registerTool(
    "hinge_login_verify_email",
    {
      title: "Verify Hinge email code",
      description: "Completes login when hinge_login_verify_otp reported email_verification_required. Needs the caseId from that result and the code Hinge emailed to the user.",
      inputSchema: {
        caseId: z.string().min(1).describe("caseId returned by hinge_login_verify_otp"),
        code: z.string().min(4).max(10).describe("The code from the verification email")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    guarded(async ({ caseId, code }) => {
      await client.auth.submitEmailCode(caseId.trim(), code.trim());
      await context.saveSession();
      return jsonResult(loginSummary(context));
    })
  );

  server.registerTool(
    "hinge_logout",
    {
      title: "Forget Hinge session",
      description: "Deletes the locally stored Hinge session file and clears in-memory tokens. Does not contact Hinge.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    guarded(async () => {
      delete client.hingeAuth;
      delete client.sendbirdAuth;
      delete client.sendbirdSessionKey;
      await context.storage.remove(context.config.sessionFile);
      return jsonResult({ status: "logged_out", sessionFile: context.config.sessionFile });
    })
  );
}

function loginSummary(context: HingeMcpContext): Record<string, unknown> {
  const { client } = context;
  return {
    status: "logged_in",
    phoneNumber: client.phoneNumber,
    identityId: client.hingeAuth?.identityId ?? null,
    hingeTokenExpires: client.hingeAuth?.expires ?? null,
    sendbirdReady: Boolean(client.sendbirdAuth?.token),
    sessionFile: context.config.sessionFile
  };
}

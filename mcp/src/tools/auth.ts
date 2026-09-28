import { OUTPUT_SCHEMAS } from "../output-schemas.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { Email2FAError } from "hinge-ts";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export function registerAuthTools(
  server: McpServer,
  context: HingeMcpContext,
): void {
  const { client } = context;

  server.registerTool(
    "hinge_session_status",
    {
      outputSchema: OUTPUT_SCHEMAS.hinge_session_status,
      title: "Hinge session status",
      description:
        "Reports local token presence, expiry, configured phone number and session path, without contacting Hinge. Call first; verify loggedIn with hinge_me. For setup help read hinge://setup or use setup_account. Never request session file contents.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(context, async () => {
      const hasToken = Boolean(client.hingeAuth?.token);
      const valid =
        hasToken && Date.parse(client.hingeAuth?.expires ?? "") > Date.now();
      return jsonResult({
        loggedIn: valid,
        hasStoredToken: hasToken,
        phoneNumber: context.hasPhoneNumber() ? client.phoneNumber : null,
        identityId: client.hingeAuth?.identityId ?? null,
        hingeTokenExpires: client.hingeAuth?.expires ?? null,
        sessionFile: context.config.sessionFile,
        readOnly: context.config.readOnly,
        nextStep: valid
          ? "call hinge_me to verify live access; this status only checks local expiry"
          : "read hinge://setup or use setup_account; reuse an existing session or establish the user's intent to send SMS before hinge_login_start",
        validation: "local_expiry_only",
      });
    }),
  );

  server.registerTool(
    "hinge_login_start",
    {
      outputSchema: OUTPUT_SCHEMAS.hinge_login_start,
      title: "Start Hinge login",
      description:
        "Sends a Hinge SMS one-time code and clears previous local login state. Check hinge_session_status first and establish the user's login intent. Uses HINGE_PHONE_NUMBER unless phoneNumber is given (E.164, e.g. +15555550123). Call once; wait for the code before hinge_login_verify_otp.",
      inputSchema: z
        .object({
          phoneNumber: z
            .string()
            .regex(PHONE_PATTERN, "use E.164 format like +15555550123")
            .optional()
            .describe(
              "Phone number in E.164 format. Optional when HINGE_PHONE_NUMBER is set.",
            ),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded(context, async ({ phoneNumber }) => {
      if (client.hingeAuth && phoneNumber && phoneNumber !== client.phoneNumber)
        throw new Error("Log out before switching accounts");
      if (phoneNumber) {
        client.phoneNumber = phoneNumber;
      }
      if (!context.hasPhoneNumber()) {
        throw new Error(
          "No phone number configured. Pass phoneNumber or set HINGE_PHONE_NUMBER.",
        );
      }
      const loginPhone = client.phoneNumber;
      await context.clearSession();
      client.phoneNumber = loginPhone;
      await client.auth.initiateSms();
      await context.saveSession();
      return jsonResult({
        status: "otp_sent",
        phoneNumber: client.phoneNumber,
        nextStep:
          "obtain the current SMS code from the user, or an available SMS tool specifically authorized for this login; submit it with hinge_login_verify_otp without echoing it; do not restart login while waiting",
      });
    }),
  );

  server.registerTool(
    "hinge_login_verify_otp",
    {
      outputSchema: OUTPUT_SCHEMAS.hinge_login_verify_otp,
      title: "Verify Hinge SMS code",
      description:
        "Submits the current SMS code from hinge_login_start; do not echo it. Session is saved on success; verify with hinge_me. If email_verification_required is returned, use its caseId and obtain the matching emailed code from the user or a specifically authorized email connector for hinge_login_verify_email.",
      inputSchema: z
        .object({
          otp: z
            .string()
            .regex(/^\d{4,10}$/)
            .describe("The numeric code from the SMS"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded(context, async ({ otp }) => {
      try {
        await client.auth.submitOtp(otp.trim());
      } catch (error) {
        if (error instanceof Email2FAError) {
          await context.saveSession();
          return jsonResult({
            status: "email_verification_required",
            caseId: error.caseId,
            email: error.email,
            nextStep:
              "obtain the current emailed code from the user, or an available email tool specifically authorized for this login; call hinge_login_verify_email with this caseId and code without echoing the code",
          });
        }
        throw error;
      }
      await client.ensureSendbirdAuth().catch(() => undefined);
      if (!client.hingeAuth?.token || !client.hingeAuth.identityId)
        throw new Error(
          "Login response did not contain Hinge credentials; start login again",
        );
      await context.saveSession();
      return jsonResult(loginSummary(context));
    }),
  );

  server.registerTool(
    "hinge_login_verify_email",
    {
      outputSchema: OUTPUT_SCHEMAS.hinge_login_verify_email,
      title: "Verify Hinge email code",
      description:
        "Completes login when hinge_login_verify_otp reported email_verification_required. Needs the caseId from that result and the code Hinge emailed to the user.",
      inputSchema: z
        .object({
          caseId: z
            .string()
            .trim()
            .min(1)
            .max(500)
            .describe("caseId returned by hinge_login_verify_otp"),
          code: z
            .string()
            .regex(/^\d{4,10}$/)
            .describe("The code from the verification email"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded(context, async ({ caseId, code }) => {
      await client.auth.submitEmailCode(caseId.trim(), code.trim());
      if (!client.hingeAuth?.token || !client.hingeAuth.identityId)
        throw new Error(
          "Login response did not contain Hinge credentials; start login again",
        );
      await context.saveSession();
      return jsonResult(loginSummary(context));
    }),
  );

  server.registerTool(
    "hinge_logout",
    {
      outputSchema: OUTPUT_SCHEMAS.hinge_logout,
      title: "Forget Hinge session",
      description:
        "Deletes the locally stored Hinge session file and clears in-memory tokens. Does not contact Hinge.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded(context, async () => {
      await context.clearSession();
      return jsonResult({
        status: "logged_out",
        sessionFile: context.config.sessionFile,
      });
    }),
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
    sessionFile: context.config.sessionFile,
  };
}

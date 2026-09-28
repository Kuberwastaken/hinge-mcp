import { readFileSync } from "node:fs";

// Packaged beside README.md; resolve relative to the module, never process.cwd().
// This is static documentation and does not read account/session data.
export const SETUP_GUIDE = readFileSync(
  new URL("../AGENTS.md", import.meta.url),
  "utf8",
);

export const SETUP_SUMMARY =
  "For setup, read hinge://setup or use the setup_account prompt. Call hinge_session_status first; loggedIn is only a local expiry check, so verify live access with hinge_me. Reuse an existing session by path without reading or displaying its secrets. If login is needed, ask only for missing details and establish the user's intent to send SMS/reset local state; do not ask again if already authorized. Call hinge_login_start once, obtain the SMS code, and call hinge_login_verify_otp. Only if email_verification_required is returned, use its caseId and the matching email code with hinge_login_verify_email. A connected SMS/email tool may retrieve the current code only with specific user authorization for that account and login; otherwise ask for manual entry. Codes in chat/tool arguments may be retained by the host. Never print tokens/codes, invent credentials, extract browser/app tokens, or resend in a loop. Verify with hinge_me and resume the original task. HTTP endpoint bearer/OAuth access is separate from Hinge login. Setup does not authorize account writes.";

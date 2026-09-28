import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type HingeMcpConfig = ReturnType<typeof configFromEnv>;
export const DEFAULT_DATA_DIR = resolve(homedir(), ".hinge-mcp");
export const isLoopback = (host: string) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error("Boolean settings must be 1/0, true/false, yes/no or on/off");
}
function integer(value: string, name: string, min: number, max: number) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
}
function secureUrl(
  value: string | undefined,
  name: string,
): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be an HTTPS URL without credentials, query or fragment`,
    );
  return value;
}
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
) {
  let portArg: string | undefined;
  let http = isTruthy(env.HINGE_MCP_HTTP);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--http") throw new Error(`Unknown argument: ${argv[i]}`);
    http = true;
    if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) portArg = argv[++i];
  }
  const sessionFile = resolve(
    env.HINGE_SESSION_FILE?.trim() || resolve(DEFAULT_DATA_DIR, "session.json"),
  );
  const phoneNumber = env.HINGE_PHONE_NUMBER?.trim() || undefined;
  if (phoneNumber && !/^\+[1-9]\d{6,14}$/.test(phoneNumber))
    throw new Error(
      "HINGE_PHONE_NUMBER must be E.164, for example +15555550123",
    );
  const publicUrl = secureUrl(
    env.HINGE_MCP_PUBLIC_URL,
    "HINGE_MCP_PUBLIC_URL",
  )?.replace(/\/$/, "");
  if (publicUrl && new URL(publicUrl).pathname !== "/mcp")
    throw new Error("HINGE_MCP_PUBLIC_URL must end in /mcp");
  const issuer = secureUrl(
    env.HINGE_MCP_OAUTH_ISSUER,
    "HINGE_MCP_OAUTH_ISSUER",
  );
  const jwksUrl = secureUrl(
    env.HINGE_MCP_OAUTH_JWKS_URL,
    "HINGE_MCP_OAUTH_JWKS_URL",
  );
  const subject = env.HINGE_MCP_OAUTH_SUBJECT?.trim();
  const token = env.HINGE_MCP_TOKEN?.trim() || undefined;
  if (
    (issuer || jwksUrl || subject) &&
    !(issuer && jwksUrl && subject && publicUrl)
  )
    throw new Error(
      "OAuth requires PUBLIC_URL, OAUTH_ISSUER, OAUTH_JWKS_URL and OAUTH_SUBJECT",
    );
  if (issuer && token)
    throw new Error("Choose OAuth or a static token, not both");
  const origins = (env.HINGE_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && isLoopback(u.hostname)))
    )
      throw new Error(
        "ALLOWED_ORIGINS must contain exact HTTPS origins (HTTP allowed on loopback)",
      );
  }
  return {
    phoneNumber,
    sessionFile,
    cacheDir: dirname(sessionFile),
    readOnly: isTruthy(env.HINGE_MCP_READ_ONLY),
    allowRaw: isTruthy(env.HINGE_MCP_ALLOW_RAW),
    http,
    port: integer(
      portArg ?? env.HINGE_MCP_PORT ?? "3939",
      "HTTP port",
      0,
      65535,
    ),
    host: env.HINGE_MCP_HOST?.trim() || "127.0.0.1",
    token,
    publicUrl,
    origins,
    oauth:
      issuer && jwksUrl && subject && publicUrl
        ? {
            issuer,
            jwksUrl,
            subject,
            audience: publicUrl,
            scope: "hinge:access",
          }
        : undefined,
    timeoutMs: integer(
      env.HINGE_MCP_TIMEOUT_MS ?? "30000",
      "TIMEOUT_MS",
      100,
      120000,
    ),
    debug: isTruthy(env.HINGE_MCP_DEBUG),
  };
}

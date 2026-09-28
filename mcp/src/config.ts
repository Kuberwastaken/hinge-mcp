import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type HingeMcpConfig = {
  phoneNumber: string | undefined;
  sessionFile: string;
  cacheDir: string;
  readOnly: boolean;
  allowRaw: boolean;
  http: boolean;
  port: number;
  host: string;
  token: string | undefined;
  debug: boolean;
};

export const DEFAULT_DATA_DIR = resolve(homedir(), ".hinge-mcp");

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): HingeMcpConfig {
  const sessionFile = resolve(env.HINGE_SESSION_FILE?.trim() || resolve(DEFAULT_DATA_DIR, "session.json"));
  const httpFlag = argv.indexOf("--http");
  const portArg = httpFlag >= 0 ? argv[httpFlag + 1] : undefined;
  const port = Number(portArg && /^\d+$/.test(portArg) ? portArg : env.HINGE_MCP_PORT ?? "3939");
  return {
    phoneNumber: env.HINGE_PHONE_NUMBER?.trim() || undefined,
    sessionFile,
    cacheDir: dirname(sessionFile),
    readOnly: isTruthy(env.HINGE_MCP_READ_ONLY),
    allowRaw: isTruthy(env.HINGE_MCP_ALLOW_RAW),
    http: httpFlag >= 0 || isTruthy(env.HINGE_MCP_HTTP),
    port: Number.isFinite(port) && port > 0 ? port : 3939,
    host: env.HINGE_MCP_HOST?.trim() || "127.0.0.1",
    token: env.HINGE_MCP_TOKEN?.trim() || undefined,
    debug: isTruthy(env.HINGE_MCP_DEBUG)
  };
}

export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

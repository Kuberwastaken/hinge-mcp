import { BrowserFetchTransport, HingeClient, type HingeLogger } from "hinge-ts";
import { basename } from "node:path";
import type { HingeMcpConfig } from "./config.js";
import { FileStorage } from "./storage.js";

export const UNSET_PHONE_NUMBER = "unset";

export type HingeMcpContext = {
  client: HingeClient;
  config: HingeMcpConfig;
  storage: FileStorage;
  sessionKey: string;
  saveSession(): Promise<void>;
  loadSession(): Promise<void>;
  hasPhoneNumber(): boolean;
};

/**
 * Builds a HingeClient that talks to Hinge directly from Node using global
 * fetch and persists the session to a file. Realtime WebSocket features are
 * not wired up; the MCP server only uses REST endpoints.
 */
export function createHingeContext(config: HingeMcpConfig, logger?: HingeLogger): HingeMcpContext {
  const storage = new FileStorage(config.cacheDir);
  const sessionKey = basename(config.sessionFile);
  let builder = HingeClient.builder()
    .phoneNumber(config.phoneNumber ?? UNSET_PHONE_NUMBER)
    .transport(new BrowserFetchTransport(logger ? { logger } : {}))
    .storage(storage);
  if (logger) {
    builder = builder.logger(logger);
  }
  const client = builder.build();
  client.persistence.configure(config.sessionFile, config.cacheDir, true);
  return {
    client,
    config,
    storage,
    sessionKey,
    saveSession: () => client.persistence.saveSession(config.sessionFile),
    loadSession: async () => {
      await client.persistence.loadSession(config.sessionFile);
      if (config.phoneNumber && client.phoneNumber === UNSET_PHONE_NUMBER) {
        client.phoneNumber = config.phoneNumber;
      }
    },
    hasPhoneNumber: () => client.phoneNumber !== UNSET_PHONE_NUMBER && client.phoneNumber.trim().length > 0
  };
}

export function stderrLogger(enabled: boolean): HingeLogger | undefined {
  if (!enabled) return undefined;
  const write = (level: string) => (...args: unknown[]) => {
    process.stderr.write(`[hinge-mcp ${level}] ${args.map(formatArg).join(" ")}\n`);
  };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

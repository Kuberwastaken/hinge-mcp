import { HingeClient, type HingeLogger, type HingePromptsManager } from "hinge-ts";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { HingeMcpConfig } from "./config.js";
import { FileStorage } from "./storage.js";
import { NodeHingeTransport, operationSignal } from "./transport.js";

export const UNSET_PHONE_NUMBER = "unset";
export type HingeMcpContext = {
  client: HingeClient;
  config: HingeMcpConfig;
  storage: FileStorage;
  sessionKey: string;
  saveSession(): Promise<void>;
  loadSession(): Promise<void>;
  clearSession(): Promise<void>;
  hasPhoneNumber(): boolean;
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
};

export function createHingeContext(config: HingeMcpConfig, logger?: HingeLogger): HingeMcpContext {
  const storage = new FileStorage(config.cacheDir);
  const client = HingeClient.builder().phoneNumber(config.phoneNumber ?? UNSET_PHONE_NUMBER)
    .storage(storage).recsFetchConfig({ multiFetchCount: 1, requestDelayMs: 0, rateLimitRetries: 0 }).build();
  client.logger = logger;
  client.transport = new NodeHingeTransport({ hinge: new URL(client.config.baseUrl).origin, sendbird: new URL(client.config.sendbirdApiUrl).origin }, config.timeoutMs, config.debug);
  // Keep personal feeds in memory; only credentials/device state go to disk.
  client.persistence.configure(config.sessionFile, config.cacheDir, false);
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let promptCache: { value: HingePromptsManager; until: number } | undefined;
  const originalManager = client.prompts.manager.bind(client.prompts);
  client.prompts.manager = async () => {
    if (promptCache && promptCache.until > Date.now()) return promptCache.value;
    const value = await originalManager();
    promptCache = { value, until: Date.now() + 15 * 60_000 };
    return value;
  };
  const authState = () => JSON.stringify([client.hingeAuth, client.sendbirdAuth, client.sendbirdSessionKey]);
  const context: HingeMcpContext = {
    client, config, storage, sessionKey: basename(config.sessionFile),
    saveSession: () => client.persistence.saveSession(config.sessionFile),
    loadSession: async () => {
      await client.persistence.loadSession(config.sessionFile);
      if (config.phoneNumber && client.phoneNumber !== UNSET_PHONE_NUMBER && config.phoneNumber !== client.phoneNumber) throw new Error("Configured phone does not match saved session; use a separate HINGE_SESSION_FILE");
      if (config.phoneNumber && client.phoneNumber === UNSET_PHONE_NUMBER) client.phoneNumber = config.phoneNumber;
    },
    clearSession: async () => {
      delete client.hingeAuth;
      delete client.sendbirdAuth;
      delete client.sendbirdSessionKey;
      client.recommendationsCache.clear();
      promptCache = undefined;
      client.phoneNumber = config.phoneNumber ?? UNSET_PHONE_NUMBER;
      client.deviceId = randomUUID(); client.installId = randomUUID(); client.sessionId = randomUUID();
      client.installed = false;
      await storage.remove(config.sessionFile);
    },
    hasPhoneNumber: () => client.phoneNumber !== UNSET_PHONE_NUMBER && client.phoneNumber.trim().length > 0,
    run: async <T>(operation: () => Promise<T>, callerSignal?: AbortSignal) => {
      if (pending >= 32) throw new Error("Account request queue is full; retry later");
      const deadline = AbortSignal.timeout(config.timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
      pending++;
      const next = tail.then(async () => {
        signal.throwIfAborted();
        const before = authState();
        try { return await operationSignal.run(signal, operation); }
        finally {
          if (client.hingeAuth && before !== authState()) await context.saveSession();
        }
      });
      tail = next.catch(() => {});
      try { return await next; } finally { pending--; }
    }
  };
  return context;
}

/** SDK errors may contain account data: diagnostics never print their payloads. */
export function stderrLogger(enabled: boolean): HingeLogger | undefined {
  if (!enabled) return undefined;
  const log = () => { process.stderr.write("[hinge-mcp] SDK diagnostic (payload omitted)\n"); };
  return { debug: log, info: log, warn: log, error: log };
}

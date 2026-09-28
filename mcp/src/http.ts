import type { HingeMcpContext } from "./client.js";

export async function startHttpServer(_context: HingeMcpContext): Promise<void> {
  throw new Error("HTTP transport is not implemented yet");
}

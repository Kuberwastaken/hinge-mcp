import { AsyncLocalStorage } from "node:async_hooks";
import {
  HingeError,
  type HingeTransport,
  type HingeTransportRequest,
  type HingeTransportResponse,
} from "hinge-ts";

export const operationSignal = new AsyncLocalStorage<AbortSignal>();

/** Only the two configured upstream origins ever receive account credentials. */
export class NodeHingeTransport implements HingeTransport {
  constructor(
    private readonly origins: { hinge: string; sendbird: string },
    private readonly timeoutMs: number,
    private readonly debug: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(
    input: HingeTransportRequest,
  ): Promise<HingeTransportResponse<T>> {
    const url = new URL(input.url);
    if (
      url.origin !== this.origins[input.service] ||
      url.username ||
      url.password
    )
      throw new Error("Upstream URL is outside the allowed service origin");
    const signal =
      operationSignal.getStore() ?? AbortSignal.timeout(this.timeoutMs);
    signal.throwIfAborted();
    const started = Date.now();
    const response = await this.fetchImpl(url, {
      method: input.method,
      headers: input.headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal,
      redirect: "error",
    });
    // Bound memory before JSON parsing, including chunked responses.
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body)
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) {
          await response.body.cancel().catch(() => {});
          throw new Error("Upstream response exceeds 4 MiB");
        }
        chunks.push(chunk);
      }
    if (this.debug)
      process.stderr.write(
        `[hinge-mcp] ${input.service} ${input.method} ${response.status} ${Date.now() - started}ms\n`,
      );
    const text = Buffer.concat(chunks).toString("utf8");
    let body: T;
    try {
      body = (text ? JSON.parse(text) : null) as T;
    } catch {
      if (!response.ok)
        throw new HingeError(
          "http",
          `Upstream returned HTTP ${response.status}`,
          { status: response.status },
        );
      throw new Error("Upstream returned invalid JSON");
    }
    // Let the SDK interpret error payloads, notably Hinge's 412 email challenge.
    // The MCP result boundary strips upstream error bodies before returning them.
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    };
  }
}

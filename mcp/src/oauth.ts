import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { HingeMcpConfig } from "./config.js";

export function createOAuthVerifier(
  config: NonNullable<HingeMcpConfig["oauth"]>,
  key?: JWTVerifyGetKey,
) {
  const jwks =
    key ??
    createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
    });
  return async (
    token: string,
  ): Promise<"ok" | "invalid_token" | "insufficient_scope"> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
        subject: config.subject,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["exp", "iat", "sub"],
      });
      const scopes =
        typeof payload.scope === "string" ? payload.scope.split(" ") : [];
      return scopes.includes(config.scope) ? "ok" : "insufficient_scope";
    } catch {
      return "invalid_token";
    }
  };
}

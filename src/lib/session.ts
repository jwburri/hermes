/**
 * Signed session cookie for the shared team login (Build Spec §4 auth).
 *
 * The cookie holds a small signed token (HS256 via jose). It carries no secret,
 * only proof that someone logged in with the correct team password. Verified
 * server-side on every protected request by proxy.ts.
 */

import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";

const ISSUER = "hermes";
const AUDIENCE = "hermes-team";
// 30 days. The team logs in rarely; this keeps them signed in.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config.auth.sessionSecret());
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return true;
  } catch {
    return false;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

/**
 * POST /api/login — check the shared team password, set the session cookie.
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import { config, SESSION_COOKIE } from "@/lib/config";
import { createSessionToken, SESSION_MAX_AGE } from "@/lib/session";

/** Constant-time password compare: hash both sides so length/prefix don't leak via timing. */
function safeCompare(a: string, b: string): boolean {
  const hash = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// ponytail: per-process Map, resets on deploy/restart and isn't shared across
// instances — fine for Hermes' single Render instance, would need a shared
// store (e.g. Redis) if it ever runs more than one.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const failedAttempts = new Map<string, { count: number; windowStart: number }>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** Drops windows older than WINDOW_MS so the map can't grow without bound. */
function pruneExpired(now: number) {
  for (const [key, entry] of failedAttempts) {
    if (now - entry.windowStart > WINDOW_MS) failedAttempts.delete(key);
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  pruneExpired(now);

  const attempts = failedAttempts.get(ip);
  if (attempts && attempts.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts. Wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!safeCompare(password, config.auth.teamPassword())) {
    if (attempts) {
      attempts.count += 1;
    } else {
      failedAttempts.set(ip, { count: 1, windowStart: now });
    }
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  failedAttempts.delete(ip);

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

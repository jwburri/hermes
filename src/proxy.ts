/**
 * Route protection (Build Spec §4, §9).
 *
 * Next.js 16 renamed `middleware` to `proxy` (Node.js runtime). This runs before
 * every matched request and bounces anyone without a valid session cookie to the
 * login page (or a 401 for API calls). The login route itself is excluded.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/config";
import { verifySessionToken } from "./lib/session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths: the login page and the login API.
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (valid) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

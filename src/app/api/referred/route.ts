/**
 * GET /api/referred?business=<name> — open referred questions, optionally
 * filtered to one business, for the /referred screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { openReferred } from "@/lib/airtable";

export async function GET(request: NextRequest) {
  const business = request.nextUrl.searchParams.get("business") ?? undefined;
  try {
    const questions = await openReferred(business || undefined);
    return NextResponse.json({ questions });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not load referred questions: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

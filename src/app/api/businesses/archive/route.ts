/**
 * POST /api/businesses/archive — retire a sold/pulled business.
 * Sets its registry Status to Archived so it leaves the dropdown.
 */

import { NextResponse } from "next/server";
import { archiveListing } from "@/lib/airtable";

export async function POST(request: Request) {
  let id = "";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "No business id" }, { status: 400 });

  try {
    await archiveListing(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not archive: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

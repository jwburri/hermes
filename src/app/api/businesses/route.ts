/**
 * GET  /api/businesses — list Active businesses for the dropdown.
 * POST /api/businesses — add a new business to the registry (Add business form).
 */

import { NextResponse } from "next/server";
import { getActiveListings, addListing } from "@/lib/airtable";
import { extractFolderId } from "@/lib/drive";

export async function GET() {
  try {
    const listings = await getActiveListings();
    return NextResponse.json({
      businesses: listings.map((l) => ({ id: l.id, name: l.businessName })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not load businesses: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let name = "";
  let driveLink = "";
  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
    driveLink = typeof body?.driveLink === "string" ? body.driveLink.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!name || !driveLink) {
    return NextResponse.json(
      { error: "Both a business name and a Drive folder link are required." },
      { status: 400 },
    );
  }

  if (!extractFolderId(driveLink)) {
    return NextResponse.json(
      { error: "That does not look like a Google Drive folder link." },
      { status: 400 },
    );
  }

  try {
    const listing = await addListing(name, driveLink);
    return NextResponse.json({ id: listing.id, name: listing.businessName });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not add the business: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

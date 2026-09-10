/**
 * PATCH /api/referred/[id] — record the seller's reply to one referred
 * question and mark it Resolved.
 */

import { NextResponse } from "next/server";
import { resolveReferred } from "@/lib/airtable";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sellerAnswer = "";
  try {
    const body = await request.json();
    sellerAnswer = typeof body?.sellerAnswer === "string" ? body.sellerAnswer.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!sellerAnswer) {
    return NextResponse.json(
      { error: "A seller answer is required." },
      { status: 400 },
    );
  }

  try {
    await resolveReferred(id, sellerAnswer);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not save the answer: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

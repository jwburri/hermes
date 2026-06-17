/**
 * POST /api/answer — the single reusable answer endpoint (Build Spec §3).
 *
 * Takes a business id plus the buyer's questions. Loads that business's Drive
 * documents and the shared brain, calls Claude, streams the formatted answer
 * back as plain text, and logs the submission to Airtable.
 *
 * The internal dropdown app calls this today; a tokenised buyer link can call
 * the same endpoint later (Phase 2) with no rebuild.
 */

import { getListingById } from "@/lib/airtable";
import { logSubmission } from "@/lib/airtable";
import { extractFolderId, loadKnowledgeBase } from "@/lib/drive";
import { loadBrain, buildUserMessage } from "@/lib/brain";
import { streamAnswer } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  let businessId = "";
  let questions = "";
  try {
    const body = await request.json();
    businessId = typeof body?.businessId === "string" ? body.businessId : "";
    questions = typeof body?.questions === "string" ? body.questions.trim() : "";
  } catch {
    return errorResponse("Invalid request", 400);
  }

  if (!businessId) return errorResponse("No business selected.", 400);
  if (!questions) return errorResponse("No questions provided.", 400);

  const listing = await getListingById(businessId);
  if (!listing) {
    return errorResponse("That business is not available.", 404);
  }

  const folderId = extractFolderId(listing.driveFolderLink);
  if (!folderId) {
    return errorResponse(
      "The Drive folder link for this business is not valid.",
      500,
    );
  }

  let knowledgeBase;
  try {
    knowledgeBase = await loadKnowledgeBase(folderId);
  } catch (err) {
    return errorResponse(
      `Could not read the business documents from Drive: ${(err as Error).message}`,
      500,
    );
  }

  const brain = await loadBrain();
  const userMessage = buildUserMessage(
    brain.contextTemplate,
    listing.businessName,
    knowledgeBase.text,
    questions,
  );

  const { textChunks } = streamAnswer(brain.systemPrompt, userMessage);

  const encoder = new TextEncoder();
  let fullAnswer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of textChunks) {
          fullAnswer += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const msg = `\n\n[Error generating answer: ${(err as Error).message}]`;
        controller.enqueue(encoder.encode(msg));
      } finally {
        controller.close();
        // Log the submission for internal review (Build Spec §10).
        // Best-effort: a logging failure must not break the answer.
        try {
          if (fullAnswer.trim()) {
            await logSubmission(listing.businessName, questions, fullAnswer);
          }
        } catch (logErr) {
          console.error("Failed to log submission:", logErr);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * POST /api/answer — the single reusable answer endpoint (Build Spec §3).
 *
 * Takes a business id plus the buyer's questions. Loads that business's Drive
 * documents and the shared brain, calls Claude, streams the answer back as
 * newline-delimited JSON events, and logs the submission to Airtable.
 *
 * Event sequence, one JSON object per line:
 *   {"type":"coverage","filesRead":[...],"filesSkipped":[...],"truncated":bool}
 *   {"type":"text","delta":"..."}          (many)
 *   {"type":"done","stopReason":...,"usage":{...},"model":"..."}
 *
 * The internal dropdown app calls this today; a tokenised buyer link can call
 * the same endpoint later (Phase 2) with no rebuild.
 */

import { getListingById } from "@/lib/airtable";
import { logSubmission } from "@/lib/airtable";
import { extractFolderId, loadKnowledgeBase, renderCoverage } from "@/lib/drive";
import { loadBrain, buildUserMessage } from "@/lib/brain";
import { streamAnswer } from "@/lib/anthropic";
import { config } from "@/lib/config";

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
  const { stablePrefix, buyerQuestions } = buildUserMessage(
    brain.contextTemplate,
    listing.businessName,
    knowledgeBase.text,
    renderCoverage(knowledgeBase),
    questions,
  );

  const answer = streamAnswer(brain.systemPrompt, stablePrefix, buyerQuestions);

  const encoder = new TextEncoder();
  let fullAnswer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      send({
        type: "coverage",
        filesRead: knowledgeBase.filesRead,
        filesSkipped: knowledgeBase.filesSkipped,
        truncated: knowledgeBase.truncated,
      });

      let result: Awaited<ReturnType<typeof answer.final>> | null = null;
      try {
        for await (const chunk of answer.textChunks) {
          fullAnswer += chunk;
          send({ type: "text", delta: chunk });
        }
        result = await answer.final();
        send({
          type: "done",
          stopReason: result.stopReason,
          usage: result.usage,
          model: result.model,
        });
      } catch (err) {
        // Still emit a done event, so the client's stopReason is never left
        // empty silently. Both sends fail harmlessly if the client is gone.
        try {
          send({
            type: "text",
            delta: `\n\n[Error generating answer: ${(err as Error).message}]`,
          });
          send({ type: "done", stopReason: "error" });
        } catch {
          // Client disconnected mid-stream; nothing to write to.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnected client.
        }
        // Log the submission for internal review (Build Spec §10).
        // Best-effort: a logging failure must not break the answer. A partial
        // answer someone may already have copied is logged too, so no answer a
        // person saw is ever missing from the log.
        try {
          if (fullAnswer.trim() && result?.stopReason !== "refusal") {
            await logSubmission(listing.businessName, questions, fullAnswer, {
              model: result?.model ?? config.anthropic.model(),
              effort: config.anthropic.effort(),
              filesRead: knowledgeBase.filesRead,
              filesSkipped: knowledgeBase.filesSkipped,
              truncated: knowledgeBase.truncated,
              stopReason: result ? (result.stopReason ?? "") : "error",
              inputTokens: result?.usage.inputTokens ?? 0,
              cacheReadTokens: result?.usage.cacheReadTokens ?? 0,
              outputTokens: result?.usage.outputTokens ?? 0,
            });
          }
        } catch (logErr) {
          console.error("Failed to log submission:", logErr);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

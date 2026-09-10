/**
 * POST /api/answer — the single reusable answer endpoint (Build Spec §3).
 *
 * Takes a business id plus the buyer's questions. Loads that business's Drive
 * documents, its recent answers and the shared brain, calls Claude, streams the
 * answer back as newline-delimited JSON events, runs a second pass that checks
 * the draft against the documents, and logs the submission to Airtable.
 *
 * Event sequence, one JSON object per line:
 *   {"type":"coverage","filesRead":[...],"filesSkipped":[...],"truncated":bool}
 *   {"type":"text","delta":"..."}          (many)
 *   {"type":"answer_end","stopReason":...,"sources":[...]}
 *   {"type":"flags","unsupported":[...],"premise":[...],"verdict":"ok"|"check"}
 *   {"type":"done","usage":{...},"model":"..."}
 *
 * The internal dropdown app calls this today; a tokenised buyer link can call
 * the same endpoint later (Phase 2) with no rebuild.
 */

import { getListingById, recentAnswers, type PriorAnswer } from "@/lib/airtable";
import { logSubmission } from "@/lib/airtable";
import { extractFolderId, loadKnowledgeBase, renderCoverage } from "@/lib/drive";
import { loadBrain, buildUserMessage } from "@/lib/brain";
import {
  streamAnswer,
  splitNotes,
  verifyAnswer,
  type Flags,
} from "@/lib/anthropic";
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

/** Prior answers as the {{PRIOR_ANSWERS}} block. */
function renderPriorAnswers(priors: PriorAnswer[]): string {
  if (!priors.length) return "None yet.";
  return priors
    .map((p) => `[${p.when}]\nQ: ${p.questions}\nA: ${p.answer}\n`)
    .join("\n");
}

/** The verification result as plain lines, for the Airtable log. */
function renderFlags(flags: Flags | null): string {
  if (!flags || flags.error) return "check did not run";
  const lines = [
    ...flags.unsupported.map((u) => `${u.claim} — ${u.why}`),
    ...flags.premise.map(
      (p) => `Buyer said ${p.buyer_said} / Documents say ${p.documents_say}`,
    ),
  ];
  return lines.length ? lines.join("\n") : "none";
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
  let priors: PriorAnswer[] = [];
  try {
    // recentAnswers never throws, so a failure here is always the Drive read.
    [knowledgeBase, priors] = await Promise.all([
      loadKnowledgeBase(folderId),
      recentAnswers(listing.businessName),
    ]);
  } catch (err) {
    return errorResponse(
      `Could not read the business documents from Drive: ${(err as Error).message}`,
      500,
    );
  }

  const brain = await loadBrain();
  const { beforeDocs, afterDocs, tail } = buildUserMessage(
    brain.contextTemplate,
    listing.businessName,
    renderCoverage(knowledgeBase),
    renderPriorAnswers(priors),
    questions,
  );
  const prompt = {
    systemPrompt: brain.systemPrompt,
    beforeDocs,
    docs: knowledgeBase.docs,
    afterDocs,
  };

  const answer = streamAnswer(prompt, tail);

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
      let buyerFacing = "";
      let notes = "";
      // null until the verification pass has run (or been deliberately skipped).
      let flags: Flags | null = null;
      try {
        for await (const chunk of answer.textChunks) {
          fullAnswer += chunk;
          send({ type: "text", delta: chunk });
        }
        result = await answer.final();
        send({
          type: "answer_end",
          stopReason: result.stopReason,
          sources: result.sources,
        });

        const split = splitNotes(fullAnswer);
        buyerFacing = split.answer;
        notes = split.notes;

        const totals = { ...result.usage };
        // Nothing to check if the model refused or produced nothing.
        if (buyerFacing && result.stopReason !== "refusal") {
          const verification = await verifyAnswer(prompt, questions, buyerFacing);
          flags = verification.flags;
          totals.inputTokens += verification.usage.inputTokens;
          totals.cacheReadTokens += verification.usage.cacheReadTokens;
          totals.cacheCreationTokens += verification.usage.cacheCreationTokens;
          totals.outputTokens += verification.usage.outputTokens;
        }
        send({
          type: "flags",
          ...(flags ?? { unsupported: [], premise: [], verdict: "ok" }),
        });
        send({ type: "done", usage: totals, model: result.model });
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
          const logged = buyerFacing || splitNotes(fullAnswer).answer;
          if (logged && result?.stopReason !== "refusal") {
            await logSubmission(listing.businessName, questions, logged, {
              model: result?.model ?? config.anthropic.model(),
              effort: config.anthropic.effort(),
              filesRead: knowledgeBase.filesRead,
              filesSkipped: knowledgeBase.filesSkipped,
              truncated: knowledgeBase.truncated,
              stopReason: result ? (result.stopReason ?? "") : "error",
              inputTokens: result?.usage.inputTokens ?? 0,
              cacheReadTokens: result?.usage.cacheReadTokens ?? 0,
              outputTokens: result?.usage.outputTokens ?? 0,
              notes,
              flaggedClaims: renderFlags(flags),
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

/**
 * POST /api/answer — the single reusable answer endpoint (Build Spec §3).
 *
 * Takes a business id plus the buyer's questions, either as JSON or as
 * multipart/form-data with files attached to this one question. Loads that
 * business's Drive documents, its recent answers, the seller's confirmed
 * answers and the shared brain, calls Claude, streams the answer back as
 * newline-delimited JSON events, runs a second pass that checks the draft
 * against the documents, and logs the submission to Airtable.
 *
 * Event sequence, one JSON object per line:
 *   {"type":"coverage","filesRead":[...],"filesSkipped":[...],"truncated":bool,
 *    "attachmentsRead":[...],"attachmentsIgnored":[...]}
 *   {"type":"text","delta":"..."}          (many)
 *   {"type":"answer_end","stopReason":...,"sources":[...]}
 *   {"type":"flags","unsupported":[...],"premise":[...],"verdict":"ok"|"check"}
 *   {"type":"referred","questions":[...]}
 *   {"type":"done","usage":{...},"model":"..."}
 *
 * The internal dropdown app calls this today; a tokenised buyer link can call
 * the same endpoint later (Phase 2) with no rebuild.
 */

import {
  addReferred,
  confirmedAnswers,
  getListingById,
  recentAnswers,
  type PriorAnswer,
} from "@/lib/airtable";
import { logSubmission } from "@/lib/airtable";
import {
  extractFolderId,
  loadKnowledgeBase,
  renderCoverage,
  type KnowledgeBase,
} from "@/lib/drive";
import { loadBrain, buildUserMessage } from "@/lib/brain";
import {
  streamAnswer,
  splitNotes,
  verifyAnswer,
  type Doc,
  type Flags,
} from "@/lib/anthropic";
import { ATTACHMENT_LIMITS, attachmentToDoc } from "@/lib/attachments";
import { extractReferred, renderConfirmedAnswers } from "@/lib/referred";
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

/** The confirmed-answers block is shown to the team as if it were a document. */
const CONFIRMED_TITLE = "Confirmed answers from the seller";

export async function POST(request: Request) {
  let businessId = "";
  let questions = "";
  const attachments: Doc[] = [];
  const attachmentsRead: string[] = [];
  const attachmentsIgnored: string[] = [];

  const asString = (value: unknown) => (typeof value === "string" ? value : "");

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("Invalid request", 400);
    }
    businessId = asString(form.get("businessId"));
    questions = asString(form.get("questions")).trim();

    // An empty file input still submits one zero-byte entry; drop those.
    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0 && !!f.name);
    if (files.length > ATTACHMENT_LIMITS.maxFiles) {
      return errorResponse("Attach at most 5 files.", 400);
    }
    const docs = await Promise.all(files.map(attachmentToDoc));
    docs.forEach((doc, i) => {
      if (doc) {
        attachments.push(doc);
        attachmentsRead.push(files[i].name);
      } else {
        attachmentsIgnored.push(files[i].name);
      }
    });
  } else {
    try {
      const body = await request.json();
      businessId = asString(body?.businessId);
      questions = asString(body?.questions).trim();
    } catch {
      return errorResponse("Invalid request", 400);
    }
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

  let loaded: KnowledgeBase;
  let priors: PriorAnswer[] = [];
  let confirmed: Awaited<ReturnType<typeof confirmedAnswers>> = [];
  try {
    // Only the Drive read throws; the two Airtable reads are best-effort.
    [loaded, priors, confirmed] = await Promise.all([
      loadKnowledgeBase(folderId),
      recentAnswers(listing.businessName),
      confirmedAnswers(listing.businessName),
    ]);
  } catch (err) {
    return errorResponse(
      `Could not read the business documents from Drive: ${(err as Error).message}`,
      500,
    );
  }

  // No documents means no answer. Without this the model would answer from
  // prior answers and memory alone, which is the one thing Hermes must not do.
  if (!loaded.docs.length) {
    return errorResponse(
      "Hermes could not read any documents in this business's Drive folder. Check the folder link in the registry and that the folder is shared with Hermes, then try again.",
      500,
    );
  }

  // A new object: loadKnowledgeBase caches and shares the one it returns.
  const confirmedText = renderConfirmedAnswers(confirmed);
  const knowledgeBase: KnowledgeBase = confirmedText
    ? {
        ...loaded,
        docs: [
          ...loaded.docs,
          { kind: "text", title: CONFIRMED_TITLE, text: confirmedText },
        ],
        filesRead: [
          ...loaded.filesRead,
          {
            name: CONFIRMED_TITLE,
            modified: confirmed.reduce(
              (latest, r) => (r.resolvedOn > latest ? r.resolvedOn : latest),
              "",
            ),
          },
        ],
      }
    : loaded;

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

  const answer = streamAnswer(prompt, tail, attachments);

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
        attachmentsRead,
        attachmentsIgnored,
      });

      let result: Awaited<ReturnType<typeof answer.final>> | null = null;
      let buyerFacing = "";
      let notes = "";
      let referred: string[] = [];
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
        referred = extractReferred(buyerFacing);

        const totals = { ...result.usage };
        // Nothing to check if the model refused or produced nothing.
        if (buyerFacing && result.stopReason !== "refusal") {
          const verification = await verifyAnswer(
            prompt,
            questions,
            buyerFacing,
            attachments,
          );
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
        send({ type: "referred", questions: referred });
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
          // The log records that files were involved; the model saw the
          // questions exactly as the team member typed them.
          const loggedQuestions = attachmentsRead.length
            ? `${questions}\n\n[Attached: ${attachmentsRead.join(", ")}]`
            : questions;
          if (logged && result?.stopReason !== "refusal") {
            await logSubmission(listing.businessName, loggedQuestions, logged, {
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
        // Same best-effort deal: the team saw the referral in the answer, so a
        // failed write here must not break anything.
        try {
          if (referred.length && result?.stopReason !== "refusal") {
            await addReferred(listing.businessName, referred);
          }
        } catch (referErr) {
          console.error("Failed to add referred questions:", referErr);
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

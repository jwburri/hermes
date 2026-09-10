/**
 * The Claude API calls (Build Spec §8).
 *
 * Two calls per submission:
 *   1. streamAnswer — the answer itself, streamed so the team sees it appear and
 *      so only visible text reaches the browser (thinking never leaves the
 *      server). Each business document is sent as its own `document` block with
 *      citations enabled, so the model's claims come back tied to a source.
 *   2. verifyAnswer — a second, non-streaming pass over the same documents that
 *      checks the draft's facts and returns JSON flags.
 *
 * Both calls send an identical system block, beforeDocs, document blocks and
 * afterDocs, so the second call reads the first's cache. Two cache breakpoints:
 * the system block and afterDocs (the last stable block). Everything before the
 * tail must stay byte-stable between calls for the same business.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey() });
  return client;
}

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral", ttl: "1h" };

/** Separates the buyer-facing answer from the internal notes (see the brain). */
export const NOTES_DELIMITER = "---NOTES FOR YOU---";

/** How much of a cited passage or answer excerpt is kept for the UI. */
const EXCERPT_CHARS = 200;

const VERIFY_MAX_TOKENS = 16000; // shared with adaptive thinking

export interface Doc {
  title: string;
  text: string;
}

/** The byte-stable half of the prompt, shared by both calls so the cache hits. */
export interface AnswerPrompt {
  systemPrompt: string;
  beforeDocs: string;
  docs: Doc[];
  afterDocs: string;
}

export interface AnswerUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** One citation: the answer text it supports, and the document it came from. */
export interface Source {
  text: string;
  title: string;
  cited: string;
}

export interface Flags {
  unsupported: { claim: string; why: string }[];
  premise: { buyer_said: string; documents_say: string }[];
  verdict: "ok" | "check";
  /** Set when the verification call itself failed, so the UI can say so. */
  error?: string;
}

export interface AnswerResult {
  stopReason: Anthropic.StopReason | null;
  usage: AnswerUsage;
  model: string;
  sources: Source[];
}

export interface AnswerStream {
  /** Async iterator of answer text chunks (visible answer only). */
  textChunks: AsyncIterable<string>;
  /** Resolves to the stop reason, usage, model and sources once complete. */
  final: () => Promise<AnswerResult>;
}

const NO_USAGE: AnswerUsage = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
};

function toUsage(usage: Anthropic.Usage): AnswerUsage {
  return {
    inputTokens: usage.input_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
  };
}

function cut(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_CHARS
    ? trimmed.slice(0, EXCERPT_CHARS) + "…"
    : trimmed;
}

/**
 * Haiku 4.5 has neither adaptive thinking nor effort, so run it plain. Keeps
 * Hermes answering if an old ANTHROPIC_MODEL value is still set in Render.
 */
function reasoning(model: string): {
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig;
} {
  if (model.includes("haiku")) return {};
  return {
    thinking: { type: "adaptive" },
    // The API validates the effort value; no local list to keep in sync.
    output_config: {
      effort: config.anthropic.effort() as Anthropic.OutputConfig["effort"],
    },
  };
}

/** The user content: prose, one document block per file, prose, uncached tail. */
function content(
  prompt: AnswerPrompt,
  tail: string,
): Anthropic.ContentBlockParam[] {
  return [
    { type: "text", text: prompt.beforeDocs },
    ...prompt.docs.map(
      (doc): Anthropic.DocumentBlockParam => ({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: doc.text },
        title: doc.title,
        citations: { enabled: true },
      }),
    ),
    { type: "text", text: prompt.afterDocs, cache_control: CACHE },
    { type: "text", text: tail },
  ];
}

function systemBlocks(prompt: AnswerPrompt): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: prompt.systemPrompt, cache_control: CACHE }];
}

/**
 * Stream an answer from Claude. Yields only `text_delta` content (the visible
 * answer, never a citation marker); thinking blocks are produced but never
 * streamed to the caller.
 */
export function streamAnswer(prompt: AnswerPrompt, tail: string): AnswerStream {
  const model = config.anthropic.model();

  const stream = getClient().messages.stream({
    model,
    max_tokens: config.anthropic.maxTokens(),
    ...reasoning(model),
    system: systemBlocks(prompt),
    messages: [{ role: "user", content: content(prompt, tail) }],
  });

  async function* iterate(): AsyncGenerator<string> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }

  return {
    textChunks: iterate(),
    final: async () => {
      // The SDK folds every citations_delta back into the final message, so the
      // accumulated blocks carry both their text and their citations.
      const final = await stream.finalMessage();
      const sources: Source[] = [];
      for (const block of final.content) {
        if (block.type !== "text" || !block.citations) continue;
        const text = cut(block.text);
        for (const citation of block.citations) {
          sources.push({
            text,
            title:
              ("document_title" in citation
                ? citation.document_title
                : citation.title) ?? "",
            cited: cut(citation.cited_text),
          });
        }
      }
      return {
        stopReason: final.stop_reason,
        model: final.model,
        usage: toUsage(final.usage),
        sources,
      };
    },
  };
}

function verifyInstruction(questions: string, answer: string): string {
  return `VERIFY MODE. Do not answer the buyer. Below is a draft buyer-facing answer that was written from the documents above. Check every factual claim, figure, date and period in it against the documents. A rounded figure is fine if it rounds correctly. List every claim the documents do not support or contradict, and every figure or claim in the buyer's message that is wrong according to the documents and was not corrected in the draft. Reply with JSON only, no prose, no code fence, in exactly this shape: {"unsupported":[{"claim":"<exact phrase from the draft>","why":"<what the documents say, or 'not in the documents'>"}],"premise":[{"buyer_said":"<phrase>","documents_say":"<correction>"}],"verdict":"ok"|"check"}

BUYER'S MESSAGE:
${questions}

DRAFT ANSWER:
${answer}`;
}

function failedFlags(): Flags {
  return {
    unsupported: [],
    premise: [],
    verdict: "check",
    error: "verification failed",
  };
}

/** Lenient parse: pull the outermost {...} out, so a code fence cannot break it. */
function parseFlags(raw: string): Flags {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return failedFlags();
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      unsupported: Array.isArray(parsed?.unsupported) ? parsed.unsupported : [],
      premise: Array.isArray(parsed?.premise) ? parsed.premise : [],
      verdict: parsed?.verdict === "ok" ? "ok" : "check",
    };
  } catch {
    return failedFlags();
  }
}

/**
 * Second pass: check the draft answer's claims against the same documents.
 * Never throws — a failed check reports itself so the UI can say it did not run.
 */
export async function verifyAnswer(
  prompt: AnswerPrompt,
  questions: string,
  answer: string,
): Promise<{ flags: Flags; usage: AnswerUsage }> {
  const model = config.anthropic.model();
  try {
    const message = await getClient().messages.create({
      model,
      max_tokens: VERIFY_MAX_TOKENS,
      ...reasoning(model),
      system: systemBlocks(prompt),
      messages: [
        {
          role: "user",
          content: content(prompt, verifyInstruction(questions, answer)),
        },
      ],
    });
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return { flags: parseFlags(text), usage: toUsage(message.usage) };
  } catch (err) {
    console.error("Verification pass failed:", (err as Error).message);
    return { flags: failedFlags(), usage: NO_USAGE };
  }
}

/** Split a reply into the buyer-facing answer and the internal notes. */
export function splitNotes(reply: string): { answer: string; notes: string } {
  const at = reply.indexOf(NOTES_DELIMITER);
  if (at === -1) return { answer: reply.trim(), notes: "" };
  return {
    answer: reply.slice(0, at).trim(),
    notes: reply.slice(at + NOTES_DELIMITER.length).trim(),
  };
}

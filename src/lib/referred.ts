/**
 * Pure helpers for referred questions: no I/O, no Airtable/network calls.
 *
 * When Hermes can't answer a buyer's question from the documents, its answer
 * for that question contains the fixed REFERRAL_LINE sentence (Build Spec —
 * see Hermes_Brain.md for the exact wording it is told to produce). These
 * helpers pull those questions back out of the rendered answer, normalise
 * them for dedupe against Airtable, and render confirmed seller replies back
 * into a block of text the model can treat as fact.
 */

export const REFERRAL_LINE = "We will send this question to the seller";

/**
 * Split a buyer-facing answer into "N. question\nA) answer" blocks and return
 * the question text of every block whose answer contains REFERRAL_LINE.
 * Trimmed, empties dropped, deduped case-insensitively. Never throws; an
 * answer with no numbered blocks returns [].
 */
export function extractReferred(buyerAnswer: string): string[] {
  const text = String(buyerAnswer ?? "");
  const lines = text.split("\n");

  // Indices of lines that start a new numbered block ("1. ", "12. ", ...).
  const startsAt: number[] = [];
  lines.forEach((line, i) => {
    if (/^\d+\.\s+/.test(line)) startsAt.push(i);
  });

  const seen = new Set<string>();
  const out: string[] = [];

  startsAt.forEach((start, idx) => {
    const end = idx + 1 < startsAt.length ? startsAt[idx + 1] : lines.length;
    const block = lines.slice(start, end).join("\n");

    const question = lines[start].replace(/^\d+\.\s+/, "").trim();
    if (!question) return;

    if (!block.includes(REFERRAL_LINE)) return;

    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(question);
  });

  return out;
}

/** Lower-case, collapse whitespace, strip trailing punctuation. For dedupe. */
export function normaliseQuestion(q: string): string {
  return String(q ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!,;:]+$/, "");
}

/**
 * Render Resolved rows as plain text for the model to treat as fact.
 * Returns "" when there are no rows.
 */
export function renderConfirmedAnswers(
  rows: { question: string; answer: string; resolvedOn: string }[],
): string {
  if (rows.length === 0) return "";

  const intro =
    "Questions previously referred to the seller, with the seller's confirmed replies. Treat these as fact, current as of the date shown.";

  const blocks = rows.map(
    (r) => `[${r.resolvedOn}]\nQ: ${r.question}\nA: ${r.answer}\n`,
  );

  return [intro, ...blocks].join("\n");
}

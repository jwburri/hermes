// Runnable check for src/lib/referred.ts. Run with: node scripts/check-referred.ts
import assert from "node:assert";
import {
  REFERRAL_LINE,
  extractReferred,
  normaliseQuestion,
  renderConfirmedAnswers,
} from "../src/lib/referred.ts";

// Plain referral: whole answer part is the referral line.
{
  const answer = `Allow me to go through and answer your questions below:

1. How much profit does the business make each month?
A) The business generates $5,243 per month in net profit on average over the last 12 months.

2. What is the exact commission you charge the seller?
A) ${REFERRAL_LINE} and get back to you when we hear back from them.`;
  assert.deepStrictEqual(extractReferred(answer), [
    "What is the exact commission you charge the seller?",
  ]);
}

// Mixed answer: some answer text, then the referral line appended.
{
  const answer = `1. Why is the seller selling?
A) The seller says they want to pursue other opportunities. ${REFERRAL_LINE} for the full reason.`;
  assert.deepStrictEqual(extractReferred(answer), [
    "Why is the seller selling?",
  ]);
}

// Non-referred question: not included.
{
  const answer = `1. How much profit does the business make each month?
A) The business generates $5,243 per month in net profit on average.`;
  assert.deepStrictEqual(extractReferred(answer), []);
}

// No numbered blocks at all.
{
  assert.deepStrictEqual(extractReferred("Just a plain paragraph, no list."), []);
  assert.deepStrictEqual(extractReferred(""), []);
}

// Dedupe within the answer (case-insensitive), and trailing punctuation on
// normaliseQuestion.
{
  const answer = `1. What is the exact commission you charge the seller?
A) ${REFERRAL_LINE}.

2. what is the exact commission you charge the seller?
A) ${REFERRAL_LINE}.`;
  assert.deepStrictEqual(extractReferred(answer), [
    "What is the exact commission you charge the seller?",
  ]);
  assert.strictEqual(
    normaliseQuestion("  What is the exact commission?! "),
    "what is the exact commission",
  );
}

// renderConfirmedAnswers.
{
  assert.strictEqual(renderConfirmedAnswers([]), "");
  const rendered = renderConfirmedAnswers([
    { question: "Why is the seller selling?", answer: "Retirement.", resolvedOn: "2026-09-01" },
  ]);
  assert.ok(rendered.includes("Treat these as fact"));
  assert.ok(rendered.includes("[2026-09-01]"));
  assert.ok(rendered.includes("Q: Why is the seller selling?"));
  assert.ok(rendered.includes("A: Retirement."));
}

console.log("check-referred: all checks passed");

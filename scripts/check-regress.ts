// Runnable check for scripts/regress-lib.ts. Run with: node scripts/check-regress.ts
import assert from "node:assert";
import {
  NOTES_DELIMITER,
  extractNumbers,
  foldNdjson,
  normaliseNumber,
  splitNotes,
  symmetricDifference,
} from "./regress-lib.ts";

// A whole stream, the way /api/answer sends it.
{
  const body = [
    JSON.stringify({
      type: "coverage",
      filesRead: [{ name: "P&L.xlsx", modified: "2026-09-01" }, { name: "GA.pdf", modified: "2026-08-30" }],
      filesSkipped: [{ name: "Logo.ai", reason: "no readable text" }],
      truncated: false,
      attachmentsRead: ["buyer-email.png"],
      attachmentsIgnored: [],
    }),
    JSON.stringify({ type: "text", delta: "1. What is May profit?\nA) $7,667.\n\n" }),
    JSON.stringify({ type: "text", delta: `${NOTES_DELIMITER}\nWatch the margin.` }),
    "", // blank lines happen; they must be ignored
    "not json at all",
    JSON.stringify({ type: "answer_end", stopReason: "end_turn", sources: [{}, {}, {}] }),
    JSON.stringify({
      type: "flags",
      unsupported: [{ claim: "$15,000 profit", why: "not in the documents" }],
      premise: [{ buyer_said: "$15,000", documents_say: "about $7,667" }],
      verdict: "check",
    }),
    JSON.stringify({ type: "referred", questions: ["What is the commission?"] }),
    JSON.stringify({
      type: "done",
      usage: { inputTokens: 100, cacheReadTokens: 90, cacheCreationTokens: 10, outputTokens: 42 },
      model: "claude-sonnet-5",
    }),
  ].join("\n");

  const f = foldNdjson(body);
  assert.strictEqual(f.filesRead, 2);
  assert.strictEqual(f.filesSkipped, 1);
  assert.strictEqual(f.truncated, false);
  assert.deepStrictEqual(f.attachmentsRead, ["buyer-email.png"]);
  assert.deepStrictEqual(f.attachmentsIgnored, []);
  assert.strictEqual(f.stopReason, "end_turn");
  assert.strictEqual(f.sources, 3);
  assert.strictEqual(f.referred.length, 1);
  assert.strictEqual(f.model, "claude-sonnet-5");
  assert.strictEqual(f.usage.outputTokens, 42);
  assert.strictEqual(f.usage.cacheReadTokens, 90);
  assert.strictEqual(f.flags?.verdict, "check");
  assert.strictEqual(f.flags?.unsupported[0].claim, "$15,000 profit");
  assert.strictEqual(f.flags?.premise[0].documents_say, "about $7,667");
  assert.strictEqual(f.flags?.error, "");

  const { answer, notes } = splitNotes(f.text);
  assert.ok(answer.includes("$7,667"));
  assert.ok(!answer.includes(NOTES_DELIMITER));
  assert.strictEqual(notes, "Watch the margin.");
}

// The error path: a done event with a stop reason and no usage.
{
  const f = foldNdjson(
    [
      JSON.stringify({ type: "text", delta: "[Error generating answer: boom]" }),
      JSON.stringify({ type: "done", stopReason: "error" }),
    ].join("\n"),
  );
  assert.strictEqual(f.stopReason, "error");
  assert.strictEqual(f.usage.outputTokens, 0);
  assert.strictEqual(f.flags, null);
}

// An empty body folds to the empty result rather than throwing.
{
  const f = foldNdjson("");
  assert.strictEqual(f.text, "");
  assert.strictEqual(f.stopReason, "");
}

// No delimiter: everything is buyer-facing.
{
  assert.deepStrictEqual(splitNotes("  Just the answer.  "), {
    answer: "Just the answer.",
    notes: "",
  });
}

// Number normalisation.
{
  assert.strictEqual(normaliseNumber("15,000"), "15000");
  assert.strictEqual(normaliseNumber("7,666.70"), "7666.7");
  assert.strictEqual(normaliseNumber("5000.00"), "5000");
  assert.strictEqual(normaliseNumber("07"), "7");
  assert.strictEqual(normaliseNumber("5.90%"), "5.9%");
  assert.strictEqual(normaliseNumber("100"), "100"); // trailing zeros survive
}

// Extraction: the currency symbol is dropped, the percent sign is not.
{
  assert.deepStrictEqual(
    extractNumbers("Revenue was $15,000 at a 5.90% margin over 12 months."),
    ["15000", "5.9%", "12"],
  );
  assert.deepStrictEqual(extractNumbers("No figures here."), []);
  assert.deepStrictEqual(extractNumbers(""), []);
}

// Consistency: the same figures written differently still match.
{
  const a = extractNumbers("May profit was $7,667.00 on revenue of $130,000.");
  const b = extractNumbers("Profit in May: 7667 (revenue 130,000).");
  assert.deepStrictEqual(symmetricDifference(a, b), []);
}

// And a real disagreement is reported both ways round, deduped.
{
  const a = extractNumbers("Profit was $7,667 and $7,667.");
  const b = extractNumbers("Profit was $15,000.");
  assert.deepStrictEqual(symmetricDifference(a, b), ["7667", "15000"]);
  assert.deepStrictEqual(symmetricDifference(b, a), ["15000", "7667"]);
}

console.log("check-regress: all checks passed");

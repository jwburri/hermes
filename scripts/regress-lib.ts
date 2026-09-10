/**
 * Pure helpers for scripts/regress.ts: folding the /api/answer NDJSON stream
 * into one result, splitting the notes off, and comparing two answers by the
 * numbers they quote. No I/O, so scripts/check-regress.ts can assert on them.
 */

// Mirrors NOTES_DELIMITER in src/lib/anthropic.ts. Duplicated so this script
// pulls in none of the app's dependencies (the Anthropic SDK, Buffer types).
export const NOTES_DELIMITER = "---NOTES FOR YOU---";

export interface Flags {
  unsupported: { claim: string; why: string }[];
  premise: { buyer_said: string; documents_say: string }[];
  verdict: string;
  error: string;
}

export interface Usage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** Everything one answer request tells us, gathered from its event stream. */
export interface Folded {
  filesRead: number;
  filesSkipped: number;
  truncated: boolean;
  attachmentsRead: string[];
  attachmentsIgnored: string[];
  /** The whole reply, notes included. */
  text: string;
  stopReason: string;
  sources: number;
  /** null until the flags event arrives. */
  flags: Flags | null;
  referred: string[];
  usage: Usage;
  model: string;
}

export function newFolded(): Folded {
  return {
    filesRead: 0,
    filesSkipped: 0,
    truncated: false,
    attachmentsRead: [],
    attachmentsIgnored: [],
    text: "",
    stopReason: "",
    sources: 0,
    flags: null,
    referred: [],
    usage: {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    },
    model: "",
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
const field = (v: unknown, key: string): unknown =>
  v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;

/**
 * Fold one NDJSON line into the accumulator, in place. Blank lines and lines
 * that are not JSON are ignored: a run must never die on a stray byte.
 */
export function foldLine(acc: Folded, line: string): Folded {
  if (!line.trim()) return acc;
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return acc;
  }
  switch (str(field(ev, "type"))) {
    case "coverage":
      acc.filesRead = arr(field(ev, "filesRead")).length;
      acc.filesSkipped = arr(field(ev, "filesSkipped")).length;
      acc.truncated = field(ev, "truncated") === true;
      acc.attachmentsRead = strs(field(ev, "attachmentsRead"));
      acc.attachmentsIgnored = strs(field(ev, "attachmentsIgnored"));
      break;
    case "text":
      acc.text += str(field(ev, "delta"));
      break;
    case "answer_end":
      acc.stopReason = str(field(ev, "stopReason"));
      acc.sources = arr(field(ev, "sources")).length;
      break;
    case "flags":
      acc.flags = {
        unsupported: arr(field(ev, "unsupported")).map((u) => ({
          claim: str(field(u, "claim")),
          why: str(field(u, "why")),
        })),
        premise: arr(field(ev, "premise")).map((p) => ({
          buyer_said: str(field(p, "buyer_said")),
          documents_say: str(field(p, "documents_say")),
        })),
        verdict: str(field(ev, "verdict")),
        error: str(field(ev, "error")),
      };
      break;
    case "referred":
      acc.referred = strs(field(ev, "questions"));
      break;
    case "done": {
      // The error path sends {"type":"done","stopReason":"error"} and no usage.
      const stop = str(field(ev, "stopReason"));
      if (stop) acc.stopReason = stop;
      const usage = field(ev, "usage");
      if (usage) {
        acc.usage = {
          inputTokens: num(field(usage, "inputTokens")),
          cacheReadTokens: num(field(usage, "cacheReadTokens")),
          cacheCreationTokens: num(field(usage, "cacheCreationTokens")),
          outputTokens: num(field(usage, "outputTokens")),
        };
      }
      acc.model = str(field(ev, "model")) || acc.model;
      break;
    }
  }
  return acc;
}

/** Fold a whole NDJSON body at once. */
export function foldNdjson(body: string): Folded {
  return body.split("\n").reduce(foldLine, newFolded());
}

/** Split a reply into the buyer-facing half and the notes for the team. */
export function splitNotes(reply: string): { answer: string; notes: string } {
  const at = reply.indexOf(NOTES_DELIMITER);
  if (at === -1) return { answer: reply.trim(), notes: "" };
  return {
    answer: reply.slice(0, at).trim(),
    notes: reply.slice(at + NOTES_DELIMITER.length).trim(),
  };
}

// Money amounts, percentages and bare numbers. The currency symbol is dropped:
// what matters is whether the two runs quote the same figure, not how it was
// written. A trailing % is kept, so 30% and 30 are different claims.
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?%?/g;

/** Strip commas, leading zeros and trailing decimal zeros: 07,500.00 -> 7500. */
export function normaliseNumber(raw: string): string {
  const percent = raw.endsWith("%");
  let n = (percent ? raw.slice(0, -1) : raw).replace(/,/g, "");
  if (n.includes(".")) n = n.replace(/0+$/, "").replace(/\.$/, "");
  n = n.replace(/^0+(?=\d)/, "");
  return percent ? `${n}%` : n;
}

/** Every number an answer quotes, normalised. Order and repeats do not matter. */
export function extractNumbers(text: string): string[] {
  return [...String(text ?? "").matchAll(NUMBER_RE)].map((m) =>
    normaliseNumber(m[0]),
  );
}

/** Numbers in one list but not the other, deduped. Empty = the two agree. */
export function symmetricDifference(a: string[], b: string[]): string[] {
  const inA = new Set(a);
  const inB = new Set(b);
  return [
    ...new Set([...a.filter((x) => !inB.has(x)), ...b.filter((x) => !inA.has(x))]),
  ];
}

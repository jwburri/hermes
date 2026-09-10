/**
 * Loads Hermes_Brain.md at runtime and turns it into the prompt the model sees.
 *
 * The brain file is the single source of truth for the system prompt (Build Spec
 * §5). Its text is never copied into code. Editing the file changes Hermes's
 * behaviour with no code change.
 *
 * The file has two regions below the "SYSTEM PROMPT" marker:
 *   1. The instructions (identity, voice, answer rules, formatting). These become
 *      the system prompt.
 *   2. The "CONTEXT INJECTED BY THE APP" section, a template with
 *      placeholders. We fill those and send the result as the user message.
 *
 * The parsed result is cached at module level, so the file is read once per
 * process. Editing it takes effect on the next deploy or restart.
 */

import { promises as fs } from "fs";
import path from "path";

const SYSTEM_MARKER =
  "SYSTEM PROMPT (everything below this line is sent to the model)";
const CONTEXT_HEADING = "## CONTEXT INJECTED BY THE APP";

export interface BrainParts {
  /** The stable instructions, used as the API system prompt. */
  systemPrompt: string;
  /** The context template (with placeholders) for the user message. */
  contextTemplate: string;
}

let cached: BrainParts | null = null;

async function readBrainFile(): Promise<string> {
  // The file sits at the repo root, bundled into the function via
  // outputFileTracingIncludes (see next.config.ts).
  const filePath = path.join(process.cwd(), "Hermes_Brain.md");
  return fs.readFile(filePath, "utf8");
}

export async function loadBrain(): Promise<BrainParts> {
  if (cached) return cached;

  const raw = await readBrainFile();

  const markerIndex = raw.indexOf(SYSTEM_MARKER);
  if (markerIndex === -1) {
    throw new Error(
      `Hermes_Brain.md is missing the "${SYSTEM_MARKER}" marker. Cannot build the system prompt.`,
    );
  }
  // Everything after the marker line.
  const afterMarker = raw.slice(raw.indexOf("\n", markerIndex) + 1);

  const contextIndex = afterMarker.indexOf(CONTEXT_HEADING);
  if (contextIndex === -1) {
    throw new Error(
      `Hermes_Brain.md is missing the "${CONTEXT_HEADING}" section. Cannot find the context template.`,
    );
  }

  // Region 1: instructions. Trim a trailing horizontal rule if present.
  let systemPrompt = afterMarker.slice(0, contextIndex).trim();
  systemPrompt = systemPrompt.replace(/\n-{3,}\s*$/, "").trim();

  // Region 2: context template. Drop the markdown heading and the meta sentence
  // that tells the app what to do (those are not meant for the model). Keep the
  // labelled placeholder lines.
  const contextSection = afterMarker.slice(contextIndex);
  const contextTemplate = contextSection
    .split("\n")
    .filter((line) => !line.startsWith("## "))
    .filter((line) => !line.startsWith("The app appends the following"))
    .join("\n")
    .trim();

  cached = { systemPrompt, contextTemplate };
  return cached;
}

export interface UserMessageParts {
  /** Template text up to {{KNOWLEDGE_BASE}}. Stable; precedes the documents. */
  beforeDocs: string;
  /**
   * Template text between the documents and {{PRIOR_ANSWERS}} (the coverage
   * lists). The last stable block, so this is where the cache breakpoint goes.
   */
  afterDocs: string;
  /** Prior answers and the buyer's questions: changes every call, never cached. */
  tail: string;
}

/**
 * Fills the placeholders in the context template and splits it into the three
 * pieces the user message is assembled from: the text before the documents, the
 * text after them (still stable, so still cacheable), and the uncached tail.
 *
 * replaceAll takes a function rather than a string so that `$&`, `$1` and
 * friends inside a document are never interpreted as replacement patterns.
 */
export function buildUserMessage(
  contextTemplate: string,
  businessName: string,
  coverage: string,
  priorAnswers: string,
  buyerQuestions: string,
): UserMessageParts {
  const find = (marker: string): number => {
    const at = contextTemplate.indexOf(marker);
    if (at === -1) {
      throw new Error(`Hermes_Brain.md context template is missing ${marker}.`);
    }
    return at;
  };
  const KB = "{{KNOWLEDGE_BASE}}";
  const kbAt = find(KB);
  const priorAt = find("{{PRIOR_ANSWERS}}");
  const questionsAt = find("{{BUYER_QUESTIONS}}");
  if (!(kbAt < priorAt && priorAt < questionsAt)) {
    throw new Error(
      "Hermes_Brain.md context template has its placeholders out of order: " +
        `${KB} must come before {{PRIOR_ANSWERS}}, which must come before {{BUYER_QUESTIONS}}.`,
    );
  }

  return {
    beforeDocs: contextTemplate
      .slice(0, kbAt)
      .replaceAll("{{BUSINESS_NAME}}", () => businessName),
    afterDocs: contextTemplate
      .slice(kbAt + KB.length, priorAt)
      .replaceAll("{{COVERAGE}}", () => coverage),
    tail: contextTemplate
      .slice(priorAt)
      .replaceAll("{{PRIOR_ANSWERS}}", () => priorAnswers)
      .replaceAll("{{BUYER_QUESTIONS}}", () => buyerQuestions),
  };
}

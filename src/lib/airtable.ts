/**
 * Airtable access: the listing registry and the Q&A log (Build Spec §6, §10).
 *
 * The registry holds one row per business (name + Drive folder link). The log
 * records every answered submission for internal review. Documents themselves
 * never live here — only links and text.
 */

import Airtable from "airtable";
import { config } from "./config";
import { normaliseQuestion } from "./referred";

export interface Listing {
  id: string;
  businessName: string;
  driveFolderLink: string;
}

function base() {
  return new Airtable({ apiKey: config.airtable.apiKey() }).base(
    config.airtable.baseId(),
  );
}

/**
 * The Active businesses for the dropdown, sorted by name. Read fresh on each
 * page load (Build Spec §7 refresh timing).
 */
export async function getActiveListings(): Promise<Listing[]> {
  const records = await base()(config.airtable.listingsTable())
    .select({
      filterByFormula: "{Status} = 'Active'",
      sort: [{ field: "Business Name", direction: "asc" }],
    })
    .all();

  return records
    .map((r) => ({
      id: r.id,
      businessName: (r.get("Business Name") as string) ?? "",
      driveFolderLink: (r.get("Drive Folder Link") as string) ?? "",
    }))
    .filter((l) => l.businessName && l.driveFolderLink);
}

/** Look up one Active listing by its Airtable record id. */
export async function getListingById(id: string): Promise<Listing | null> {
  try {
    const r = await base()(config.airtable.listingsTable()).find(id);
    if ((r.get("Status") as string) !== "Active") return null;
    const businessName = (r.get("Business Name") as string) ?? "";
    const driveFolderLink = (r.get("Drive Folder Link") as string) ?? "";
    if (!businessName || !driveFolderLink) return null;
    return { id: r.id, businessName, driveFolderLink };
  } catch {
    return null;
  }
}

/** Add a new Active business to the registry (the "Add business" form). */
export async function addListing(
  businessName: string,
  driveFolderLink: string,
  addedBy?: string,
): Promise<Listing> {
  const fields: Record<string, string> = {
    "Business Name": businessName,
    "Drive Folder Link": driveFolderLink,
    Status: "Active",
    "Added On": new Date().toISOString().slice(0, 10),
  };
  if (addedBy) fields["Added By"] = addedBy;

  const created = await base()(config.airtable.listingsTable()).create([
    { fields },
  ]);
  const r = created[0];
  return {
    id: r.id,
    businessName: (r.get("Business Name") as string) ?? businessName,
    driveFolderLink: (r.get("Drive Folder Link") as string) ?? driveFolderLink,
  };
}

/**
 * Archive a business: set Status to Archived so it drops out of the dropdown and
 * Hermes stops answering for it. Reversible (the row and its history are kept).
 */
export async function archiveListing(id: string): Promise<void> {
  await base()(config.airtable.listingsTable()).update([
    { id, fields: { Status: "Archived" } },
  ]);
}

/** One earlier answer for this business, fed back in as {{PRIOR_ANSWERS}}. */
export interface PriorAnswer {
  /** yyyy-mm-dd. */
  when: string;
  questions: string;
  answer: string;
}

// Prior answers are context, not the source of truth, so they are capped.
const PRIOR_FIELD_CHARS = 1200;

/**
 * The most recent logged Q&A for a business, newest first, so Hermes stays
 * consistent with what buyers have already been told. Best-effort: on any
 * failure this returns nothing rather than blocking the answer.
 */
export async function recentAnswers(
  businessName: string,
  limit = 8,
): Promise<PriorAnswer[]> {
  try {
    const name = businessName.replace(/'/g, "\\'");
    const records = await base()(config.airtable.logTable())
      .select({
        filterByFormula: `{Business} = '${name}'`,
        sort: [{ field: "Timestamp", direction: "desc" }],
        fields: ["Buyer Questions", "Hermes Answer", "Timestamp"],
        maxRecords: limit,
      })
      .all();

    const cut = (value: unknown) =>
      String(value ?? "").slice(0, PRIOR_FIELD_CHARS);

    return records.map((r) => ({
      when: String(r.get("Timestamp") ?? "").slice(0, 10),
      questions: cut(r.get("Buyer Questions")),
      answer: cut(r.get("Hermes Answer")),
    }));
  } catch (err) {
    console.error("Could not load prior answers:", err);
    return [];
  }
}

/** The run detail written alongside the answer, for internal review. */
export interface AnswerLogMeta {
  model: string;
  effort: string;
  filesRead: { name: string; modified: string }[];
  filesSkipped: { name: string; reason: string }[];
  truncated: boolean;
  stopReason: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** The internal notes half of the reply (never shown to the buyer). */
  notes: string;
  /** The verification pass rendered for a human to read. */
  flaggedClaims: string;
}

/**
 * Write one row to the Q&A log for an answered submission (Build Spec §10).
 *
 * The meta columns are added to Airtable separately. If the full write fails
 * for any reason it is retried with the four original fields, so logging never
 * breaks the answer.
 */
export async function logSubmission(
  businessName: string,
  buyerQuestions: string,
  hermesAnswer: string,
  meta?: AnswerLogMeta,
): Promise<void> {
  const table = base()(config.airtable.logTable());
  const core = {
    Business: businessName,
    Timestamp: new Date().toISOString(),
    "Buyer Questions": buyerQuestions,
    "Hermes Answer": hermesAnswer,
  };

  if (!meta) {
    await table.create([{ fields: core }]);
    return;
  }

  const fields = {
    ...core,
    Model: meta.model,
    Effort: meta.effort,
    "Files Read": meta.filesRead
      .map((f) => `${f.name} (${f.modified})`)
      .join("\n"),
    "Files Skipped": meta.filesSkipped
      .map((f) => `${f.name} — ${f.reason}`)
      .join("\n"),
    Truncated: meta.truncated,
    "Stop Reason": meta.stopReason,
    "Hermes Notes": meta.notes,
    "Flagged Claims": meta.flaggedClaims,
    "Input Tokens": meta.inputTokens,
    "Cache Read Tokens": meta.cacheReadTokens,
    "Output Tokens": meta.outputTokens,
  };

  try {
    await table.create([{ fields }]);
  } catch (err) {
    console.error("Q&A log write failed, retrying without meta columns:", err);
    await table.create([{ fields: core }]);
  }
}

/** Escape a value for use inside an Airtable formula string literal. */
function escapeFormula(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** Airtable batch create/update size limit. */
const AIRTABLE_BATCH_SIZE = 10;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One row from the Hermes Referred Questions table (Build Spec: referrals). */
export interface ReferredQuestion {
  id: string;
  business: string;
  question: string;
  created: string;
}

/**
 * Open referred questions, optionally for one business, newest first. Used
 * by the /referred screen.
 */
export async function openReferred(
  businessName?: string,
): Promise<ReferredQuestion[]> {
  const clauses = ["{Status} = 'Open'"];
  if (businessName) {
    clauses.push(`{Business} = '${escapeFormula(businessName)}'`);
  }
  const filterByFormula =
    clauses.length === 1 ? clauses[0] : `AND(${clauses.join(", ")})`;

  const records = await base()(config.airtable.referredTable())
    .select({
      filterByFormula,
      sort: [{ field: "Created", direction: "desc" }],
    })
    .all();

  return records.map((r) => ({
    id: r.id,
    business: (r.get("Business") as string) ?? "",
    question: (r.get("Question") as string) ?? "",
    created: (r.get("Created") as string) ?? "",
  }));
}

/**
 * Record the seller's reply to one referred question: fills in the answer,
 * marks it Resolved, and stamps today's date. Throws on failure so the API
 * route can report it — unlike the best-effort reads, a save the team
 * clicked on must not silently vanish.
 */
export async function resolveReferred(
  id: string,
  sellerAnswer: string,
): Promise<void> {
  await base()(config.airtable.referredTable()).update([
    {
      id,
      fields: {
        "Seller Answer": sellerAnswer,
        Status: "Resolved",
        "Resolved On": today(),
      },
    },
  ]);
}

// Confirmed answers are context fed back into future prompts, so they are capped.
const CONFIRMED_ANSWERS_LIMIT = 50;

/**
 * Resolved rows with a confirmed seller answer for a business, oldest first,
 * fed back in as {{CONFIRMED_ANSWERS}}. Best-effort: on any failure this
 * returns nothing rather than blocking the answer.
 */
export async function confirmedAnswers(
  businessName: string,
): Promise<{ question: string; answer: string; resolvedOn: string }[]> {
  try {
    const name = escapeFormula(businessName);
    const records = await base()(config.airtable.referredTable())
      .select({
        filterByFormula: `AND({Business} = '${name}', {Status} = 'Resolved', {Seller Answer} != '')`,
        sort: [{ field: "Resolved On", direction: "asc" }],
        fields: ["Question", "Seller Answer", "Resolved On"],
        maxRecords: CONFIRMED_ANSWERS_LIMIT,
      })
      .all();

    return records.map((r) => ({
      question: (r.get("Question") as string) ?? "",
      answer: (r.get("Seller Answer") as string) ?? "",
      resolvedOn: (r.get("Resolved On") as string) ?? "",
    }));
  } catch (err) {
    console.error("Could not load confirmed answers:", err);
    return [];
  }
}

/**
 * Record newly referred questions for a business, skipping any that already
 * exist (open or resolved) for it. Best-effort: on any failure this logs and
 * returns none added rather than blocking the answer.
 */
export async function addReferred(
  businessName: string,
  questions: string[],
): Promise<string[]> {
  try {
    const name = escapeFormula(businessName);
    const existing = await base()(config.airtable.referredTable())
      .select({
        filterByFormula: `{Business} = '${name}'`,
        fields: ["Question"],
      })
      .all();

    const existingKeys = new Set(
      existing.map((r) => normaliseQuestion((r.get("Question") as string) ?? "")),
    );

    const toAdd = questions.filter(
      (q) => !existingKeys.has(normaliseQuestion(q)),
    );
    if (toAdd.length === 0) return [];

    const created = today();
    const table = base()(config.airtable.referredTable());
    for (let i = 0; i < toAdd.length; i += AIRTABLE_BATCH_SIZE) {
      const batch = toAdd.slice(i, i + AIRTABLE_BATCH_SIZE).map((question) => ({
        fields: {
          Business: businessName,
          Question: question,
          Status: "Open",
          Created: created,
        },
      }));
      await table.create(batch);
    }

    return toAdd;
  } catch (err) {
    console.error("Could not add referred questions:", err);
    return [];
  }
}

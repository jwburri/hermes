/**
 * Airtable access: the listing registry and the Q&A log (Build Spec §6, §10).
 *
 * The registry holds one row per business (name + Drive folder link). The log
 * records every answered submission for internal review. Documents themselves
 * never live here — only links and text.
 */

import Airtable from "airtable";
import { config } from "./config";

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

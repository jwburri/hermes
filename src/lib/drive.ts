/**
 * Google Drive document ingestion (Build Spec §7).
 *
 * Reads every file in a business's registered (buyer-safe) Drive folder through
 * a read-only service account and extracts plain text from each, building the
 * {{KNOWLEDGE_BASE}} block. Files stay in Drive; nothing is copied or stored.
 */

import { google, drive_v3 } from "googleapis";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { config } from "./config";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// Rough guard: ~4 chars per token, model holds ~150k words (~200k tokens).
// Stop well short so a request never fails for size (Build Spec §7).
const MAX_KB_CHARS = 600_000;
// No single file may swamp the knowledge base. Anything longer is truncated.
const MAX_FILE_CHARS = 300_000;
// How deep to walk subfolders inside the registered folder.
const MAX_DEPTH = 3;

// Confidential files Hermes must NEVER read, matched on file/folder name
// (case-insensitive). This is a hard, deterministic exclusion — the bytes never
// reach the model, so it does not depend on the brain's guardrails. The primary
// defence is still keeping these out of the registered folder; this is a backstop
// for anything accidentally left in. Tune the list as naming conventions change.
const EXCLUDE_PATTERNS: RegExp[] = [
  /\blegals?\b/i, // "Legals" folder, "Legal Advice.pdf", …
  /broker/i, // broker / brokering / brokerage agreement
  /commission/i, // commission or fee detail
  /engagement letter/i,
  /call[\s_-]?summary/i, // internal call notes
  /asset purchase agreement/i, // deal contract: parties, price, terms
  /outreach/i, // internal buyer-prospecting lists/trackers
];

// Deal documents, matched against FILE names only: a folder called
// "LOI Dataroom" can legitimately hold the buyer-safe data room. Letter-based
// boundaries rather than \b, because "_" counts as a word character and
// "Gronanda_LOI_v2" would otherwise slip through.
const DEAL_FILE_PATTERNS: RegExp[] = [
  /(?<![a-z])LOI(?![a-z])/i, // letter of intent
  /(?<![a-z])APA(?![a-z])/i, // asset purchase agreement (abbreviated)
  /letter of intent/i,
  /negotiat/i,
  /term sheet/i,
  /heads of terms/i,
];

/** The one reason string for a confidential exclusion. */
const EXCLUDED_REASON = "excluded (confidential)";

// At most this many "Not read" entries reach the prompt, so a huge folder
// cannot bloat it.
const MAX_COVERAGE_SKIPPED = 40;

function isExcluded(name: string, isFolder: boolean): boolean {
  return (
    EXCLUDE_PATTERNS.some((re) => re.test(name)) ||
    (!isFolder && DEAL_FILE_PATTERNS.some((re) => re.test(name)))
  );
}

export interface FileRead {
  name: string;
  /** Last modified date as yyyy-mm-dd, or "unknown" if Drive reported none. */
  modified: string;
}

export interface FileSkipped {
  name: string;
  reason: string;
}

export interface KnowledgeBase {
  /** The concatenated, labelled text of every readable file. */
  text: string;
  /** Files successfully read. */
  filesRead: FileRead[];
  /** Files skipped (e.g. image-only, unreadable, excluded) with a reason. */
  filesSkipped: FileSkipped[];
  /** True if any file was truncated or the overall size cap was reached. */
  truncated: boolean;
}

/**
 * The two coverage lists that go into the prompt, so the model knows what it
 * did and did not see. Dates only (no time), so this stays byte-stable between
 * calls for the same business and the prompt cache keeps hitting.
 */
export function renderCoverage(kb: KnowledgeBase): string {
  const read = kb.filesRead.length
    ? kb.filesRead
        .map((f) => `Read: ${f.name} (last modified ${f.modified})`)
        .join("\n")
    : "Read: none";
  // Confidential exclusions are left out entirely: the model must never learn
  // that a deal document exists. They stay in kb.filesSkipped for the UI/log.
  const notRead = kb.filesSkipped.filter((f) => f.reason !== EXCLUDED_REASON);
  const lines = notRead
    .slice(0, MAX_COVERAGE_SKIPPED)
    .map((f) => `Not read: ${f.name} (${f.reason})`);
  if (notRead.length > MAX_COVERAGE_SKIPPED) {
    lines.push(`…and ${notRead.length - MAX_COVERAGE_SKIPPED} more`);
  }
  return `${read}\n${lines.length ? lines.join("\n") : "Not read: none"}`;
}

let driveClient: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const credentials = JSON.parse(config.google.serviceAccountJson());
  // Safeguard against double-escaped newlines in the private key.
  if (
    typeof credentials.private_key === "string" &&
    credentials.private_key.includes("\\n")
  ) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_SCOPE],
  });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

/** Pull the folder id out of any normal Drive share link (or a bare id). */
export function extractFolderId(link: string): string | null {
  if (!link) return null;
  const trimmed = link.trim();

  // .../folders/<id>
  const folders = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folders) return folders[1];

  // ...?id=<id> or ...&id=<id>
  const idParam = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idParam) return idParam[1];

  // A bare id with no slashes.
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;

  return null;
}

async function downloadBuffer(fileId: string): Promise<Buffer> {
  const res = await getDrive().files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function exportText(fileId: string, mimeType: string): Promise<string> {
  const res = await getDrive().files.export(
    { fileId, mimeType },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer).toString("utf8");
}

/**
 * Reviewer questions and seller replies often live in a file's Drive comments,
 * not its body text (the export does not include them). Fetch them and format
 * them as labelled Q&A. Author names are omitted to avoid leaking identity.
 */
async function fetchComments(fileId: string): Promise<string> {
  try {
    const res = await getDrive().comments.list({
      fileId,
      fields: "comments(content,quotedFileContent/value,replies(content))",
      pageSize: 100,
      includeDeleted: false,
    });
    const comments = res.data.comments ?? [];
    const blocks: string[] = [];
    for (const c of comments) {
      const content = (c.content ?? "").trim();
      if (!content) continue;
      const quoted = c.quotedFileContent?.value?.trim();
      blocks.push(quoted ? `- On "${quoted}": ${content}` : `- ${content}`);
      for (const r of c.replies ?? []) {
        const reply = (r.content ?? "").trim();
        if (reply) blocks.push(`    reply: ${reply}`);
      }
    }
    if (!blocks.length) return "";
    return (
      "\n--- Reviewer questions and seller replies (from document comments) ---\n" +
      blocks.join("\n") +
      "\n"
    );
  } catch {
    // Comments unavailable for this file type; ignore.
    return "";
  }
}

/**
 * Every tab of a workbook as labelled CSV. cellDates + dateNF keep dates
 * readable (2024-03-01) instead of Excel serials (45352), and blankrows drops
 * rows that are entirely empty.
 */
function xlsxToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    dateNF: "yyyy-mm-dd",
  });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], {
      dateNF: "yyyy-mm-dd",
      blankrows: false,
    });
    return `# Sheet: ${name}\n${csv}`;
  }).join("\n\n");
}

/** Export a Google-native file as bytes (rather than as text). */
async function exportBuffer(fileId: string, mimeType: string): Promise<Buffer> {
  const res = await getDrive().files.export(
    { fileId, mimeType },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Extract text from a single Drive file. Returns null if unreadable. */
async function extractFile(
  file: drive_v3.Schema$File,
): Promise<string | null> {
  const mime = file.mimeType ?? "";
  const id = file.id!;

  switch (mime) {
    case "application/vnd.google-apps.document":
      return exportText(id, "text/plain");
    case "application/vnd.google-apps.spreadsheet":
      // CSV export only returns the first tab, so go via xlsx to get them all.
      try {
        return xlsxToText(
          await exportBuffer(
            id,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ),
        );
      } catch {
        return exportText(id, "text/csv"); // first tab only, better than nothing
      }
    case "application/vnd.google-apps.presentation":
      return exportText(id, "text/plain");
    case "application/pdf": {
      // Dynamic import keeps the heavy PDF dependencies out of routes that
      // never parse a PDF (e.g. the businesses list).
      const { PDFParse } = await import("pdf-parse");
      const buf = await downloadBuffer(id);
      const parser = new PDFParse({ data: buf });
      try {
        const result = await parser.getText();
        const text = result.text.trim();
        // Image-only PDFs yield no extractable text (Build Spec §7).
        return text.length > 0 ? text : null;
      } finally {
        await parser.destroy();
      }
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const buf = await downloadBuffer(id);
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value;
    }
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      const buf = await downloadBuffer(id);
      return xlsxToText(buf);
    }
    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return (await downloadBuffer(id)).toString("utf8");
    default:
      // .md sometimes arrives as application/octet-stream or no mime.
      if (/\.(md|markdown|txt)$/i.test(file.name ?? "")) {
        return (await downloadBuffer(id)).toString("utf8");
      }
      return null;
  }
}

async function listFolder(folderId: string): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await getDrive().files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      orderBy: "folder,name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  // Deterministic order, so the cached prompt prefix stays byte-stable. Plain
  // codepoint order, not localeCompare, which varies with the host locale.
  return files.sort((a, b) => {
    const [x, y] = [a.name ?? "", b.name ?? ""];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

type Item =
  | { name: string; reason: string }
  | { name: string; modified: string; text: string; cut: boolean };

/**
 * Walk a folder tree and extract every readable file. Files within a folder
 * (and sibling subfolders) are fetched in parallel; the returned list keeps
 * Drive's sorted order so the prompt stays byte-stable.
 */
async function collect(id: string, depth: number): Promise<Item[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await listFolder(id);
  const nested = await Promise.all(
    entries.map(async (file): Promise<Item[]> => {
      const name = file.name ?? "(untitled)";
      const isFolder =
        file.mimeType === "application/vnd.google-apps.folder";
      // Hard exclusion: confidential files/folders are never read (backstop to
      // keeping them out of the registered folder).
      if (isExcluded(name, isFolder)) return [{ name, reason: EXCLUDED_REASON }];
      if (isFolder) return collect(file.id!, depth + 1);
      try {
        let text = (await extractFile(file))?.trim() ?? "";
        if (!text) return [{ name, reason: "no readable text" }];
        const cut = text.length > MAX_FILE_CHARS;
        if (cut) {
          text =
            text.slice(0, MAX_FILE_CHARS) +
            "\n[truncated: file exceeds size cap]";
        }
        const comments = await fetchComments(file.id!);
        return [
          {
            name,
            modified: (file.modifiedTime ?? "").slice(0, 10) || "unknown",
            text: `${text}\n${comments}`,
            cut,
          },
        ];
      } catch (err) {
        // Fixed reason string, so the cached prompt prefix stays byte-stable.
        console.error(`Drive read error for ${name}:`, (err as Error).message);
        return [{ name, reason: "read error" }];
      }
    }),
  );
  return nested.flat();
}

/** Concatenate the collected files with filename labels, applying the size caps. */
async function buildKnowledgeBase(folderId: string): Promise<KnowledgeBase> {
  const filesRead: FileRead[] = [];
  const filesSkipped: FileSkipped[] = [];
  const sections: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const item of await collect(folderId, 0)) {
    if ("reason" in item) {
      filesSkipped.push(item);
      continue;
    }
    const section = `===== FILE: ${item.name} =====\n${item.text}`;
    if (totalChars + section.length > MAX_KB_CHARS) {
      truncated = true;
      filesSkipped.push({
        name: item.name,
        reason: "knowledge base size cap reached",
      });
      continue;
    }
    if (item.cut) truncated = true;
    sections.push(section);
    filesRead.push({ name: item.name, modified: item.modified });
    totalChars += section.length;
  }

  return { text: sections.join("\n"), filesRead, filesSkipped, truncated };
}

// ponytail: per-process in-memory cache; move to a shared store if Hermes ever
// runs more than one instance. Storing the promise also dedupes concurrent
// requests for the same business.
const KB_TTL_MS = 5 * 60 * 1000;
const kbCache = new Map<string, { at: number; kb: Promise<KnowledgeBase> }>();

/**
 * Load the knowledge base for a registered folder, reusing a copy fetched in
 * the last five minutes (Build Spec §7).
 */
export function loadKnowledgeBase(folderId: string): Promise<KnowledgeBase> {
  const hit = kbCache.get(folderId);
  if (hit && Date.now() - hit.at < KB_TTL_MS) return hit.kb;
  const kb = buildKnowledgeBase(folderId);
  kbCache.set(folderId, { at: Date.now(), kb });
  kb.catch(() => kbCache.delete(folderId));
  return kb;
}

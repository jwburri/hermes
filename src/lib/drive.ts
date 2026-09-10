/**
 * Google Drive document ingestion (Build Spec §7).
 *
 * Reads every file in a business's registered (buyer-safe) Drive folder through
 * a read-only service account and turns each into a citable document, building
 * the {{KNOWLEDGE_BASE}} block. Three kinds come out: extracted text, native
 * PDFs (scanned or screenshot PDFs the model reads visually) and images. Files
 * stay in Drive; nothing is copied or stored.
 */

import { google, drive_v3 } from "googleapis";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { Doc } from "./anthropic";
import { config } from "./config";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// Rough guard: ~4 chars per token, model holds ~150k words (~200k tokens).
// Stop well short so a request never fails for size (Build Spec §7).
const MAX_KB_CHARS = 600_000;
// No single file may swamp the knowledge base. Text only; anything longer is
// truncated.
const MAX_FILE_CHARS = 300_000;
// How deep to walk subfolders inside the registered folder.
const MAX_DEPTH = 3;

// Native PDFs and images are sent as base64. The API request limit is 32 MB;
// stop well short of it across all of them.
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Claude reads at most 600 PDF pages per document on the 1M-context model.
const MAX_PDF_PAGES = 600;
// Below this much extracted text per page a PDF is a scan or screenshots, so
// it is worth the tokens to have the model read the pages visually instead.
const MIN_PDF_TEXT_PER_PAGE = 200;
// Size-budget weights: a visual page costs far more than its bytes suggest.
const PDF_PAGE_CHARS = 8_000;
const IMAGE_CHARS = 6_000;

/** The one reason string for anything past a per-file size cap. */
const TOO_LARGE_REASON = "too large to read";

/** Base64 inflates by 4/3; count what will actually be sent. */
function base64Bytes(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/**
 * Drive's declared size, checked before the download so an oversized file is
 * never pulled into memory. Uploaded binaries always report one; anything that
 * does not is still bounded by the total payload cap.
 */
function tooBig(file: drive_v3.Schema$File, max: number): boolean {
  return Number(file.size ?? 0) > max;
}

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
  /**
   * The files read, in Drive's sorted order: extracted text, a native PDF or an
   * image, each titled with its file name. A pdf/image with Drive comments is
   * followed by a "<name> (comments)" text doc carrying them.
   */
  docs: Doc[];
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
export function xlsxToText(buffer: Buffer): string {
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

/**
 * What one Drive file yielded: a document plus its weight against the size
 * budget, a fixed skip reason, or null for "no readable text". Text weighs its
 * own length (recomputed once truncation and comments are applied); a visual
 * page or an image costs far more per byte, so it carries its own estimate.
 */
type Extracted = { doc: Doc; chars: number } | { reason: string } | null;

function textDoc(title: string, text: string): Extracted {
  return { doc: { kind: "text", title, text }, chars: text.length };
}

/** Read a single Drive file as a document. Returns null if unreadable. */
async function extractFile(file: drive_v3.Schema$File): Promise<Extracted> {
  const mime = file.mimeType ?? "";
  const id = file.id!;
  const title = file.name ?? "(untitled)";

  switch (mime) {
    case "application/vnd.google-apps.document":
      return textDoc(title, await exportText(id, "text/plain"));
    case "application/vnd.google-apps.spreadsheet":
      // CSV export only returns the first tab, so go via xlsx to get them all.
      try {
        return textDoc(
          title,
          xlsxToText(
            await exportBuffer(
              id,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
          ),
        );
      } catch {
        // First tab only, better than nothing.
        return textDoc(title, await exportText(id, "text/csv"));
      }
    case "application/vnd.google-apps.presentation":
      return textDoc(title, await exportText(id, "text/plain"));
    case "application/pdf": {
      if (tooBig(file, MAX_PDF_BYTES)) return { reason: TOO_LARGE_REASON };
      const buf = await downloadBuffer(id);
      // Dynamic import keeps the heavy PDF dependencies out of routes that
      // never parse a PDF (e.g. the businesses list).
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buf });
      let text = "";
      let pages = 1;
      try {
        const result = await parser.getText();
        text = result.text.trim();
        pages = Math.max(result.total, 1);
      } finally {
        await parser.destroy();
      }
      // Enough text to work with: cheap, and citations come back per character.
      if (text.length >= MIN_PDF_TEXT_PER_PAGE * pages) {
        return textDoc(title, text);
      }
      // A scan or screenshots: send the bytes so the model reads the pages.
      if (pages > MAX_PDF_PAGES) return { reason: TOO_LARGE_REASON };
      return {
        doc: { kind: "pdf", title, data: buf },
        chars: PDF_PAGE_CHARS * pages,
      };
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const buf = await downloadBuffer(id);
      const result = await mammoth.extractRawText({ buffer: buf });
      return textDoc(title, result.value);
    }
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      const buf = await downloadBuffer(id);
      return textDoc(title, xlsxToText(buf));
    }
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp": {
      if (tooBig(file, MAX_IMAGE_BYTES)) return { reason: TOO_LARGE_REASON };
      const buf = await downloadBuffer(id);
      return {
        doc: { kind: "image", title, data: buf, mediaType: mime },
        chars: IMAGE_CHARS,
      };
    }
    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return textDoc(title, (await downloadBuffer(id)).toString("utf8"));
    default:
      // .md sometimes arrives as application/octet-stream or no mime.
      if (/\.(md|markdown|txt)$/i.test(file.name ?? "")) {
        return textDoc(title, (await downloadBuffer(id)).toString("utf8"));
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
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
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
  | {
      name: string;
      modified: string;
      /** The file's document, plus a comments doc when it cannot hold them. */
      docs: Doc[];
      chars: number;
      /** Base64 payload this file adds, 0 for text. */
      bytes: number;
      cut: boolean;
    };

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
        const extracted = await extractFile(file);
        if (!extracted) return [{ name, reason: "no readable text" }];
        if ("reason" in extracted) return [{ name, reason: extracted.reason }];

        const modified = (file.modifiedTime ?? "").slice(0, 10) || "unknown";
        const comments = await fetchComments(file.id!);
        const doc = extracted.doc;

        if (doc.kind !== "text") {
          // A pdf/image document cannot carry appended text, so its comments
          // become their own document right after it.
          const docs: Doc[] = [doc];
          if (comments) {
            docs.push({
              kind: "text",
              title: `${name} (comments)`,
              text: comments,
            });
          }
          return [
            {
              name,
              modified,
              docs,
              chars: extracted.chars + comments.length,
              bytes: base64Bytes(doc.data.length),
              cut: false,
            },
          ];
        }

        let text = doc.text.trim();
        if (!text) return [{ name, reason: "no readable text" }];
        const cut = text.length > MAX_FILE_CHARS;
        if (cut) {
          text =
            text.slice(0, MAX_FILE_CHARS) +
            "\n[truncated: file exceeds size cap]";
        }
        text = `${text}\n${comments}`;
        return [
          {
            name,
            modified,
            docs: [{ kind: "text", title: name, text }],
            chars: text.length,
            bytes: 0,
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

/** Collect the readable files as citable documents, applying the size caps. */
async function buildKnowledgeBase(folderId: string): Promise<KnowledgeBase> {
  const filesRead: FileRead[] = [];
  const filesSkipped: FileSkipped[] = [];
  const docs: Doc[] = [];
  let totalChars = 0;
  let totalBytes = 0;
  let truncated = false;

  for (const item of await collect(folderId, 0)) {
    if ("reason" in item) {
      filesSkipped.push(item);
      continue;
    }
    if (
      totalChars + item.chars > MAX_KB_CHARS ||
      totalBytes + item.bytes > MAX_PAYLOAD_BYTES
    ) {
      truncated = true;
      filesSkipped.push({
        name: item.name,
        reason: "knowledge base size cap reached",
      });
      continue;
    }
    if (item.cut) truncated = true;
    docs.push(...item.docs);
    filesRead.push({ name: item.name, modified: item.modified });
    totalChars += item.chars;
    totalBytes += item.bytes;
  }

  return { docs, filesRead, filesSkipped, truncated };
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

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
// How deep to walk subfolders inside the registered folder.
const MAX_DEPTH = 3;

// Confidential files Hermes must NEVER read, matched on file/folder name
// (case-insensitive). This is a hard, deterministic exclusion — the bytes never
// reach the model, so it does not depend on the brain's guardrails. The primary
// defence is still keeping these out of the registered folder; this is a backstop
// for anything accidentally left in. Tune the list as naming conventions change.
const EXCLUDE_PATTERNS: RegExp[] = [
  /broker/i, // broker / brokering / brokerage agreement
  /commission/i, // commission or fee detail
  /engagement letter/i,
  /call[\s_-]?summary/i, // internal call notes
  /asset purchase agreement/i, // deal contract: parties, price, terms
  /outreach/i, // internal buyer-prospecting lists/trackers
];

function isExcluded(name: string): boolean {
  return EXCLUDE_PATTERNS.some((re) => re.test(name));
}

export interface KnowledgeBase {
  /** The concatenated, labelled text of every readable file. */
  text: string;
  /** Filenames successfully read. */
  filesRead: string[];
  /** Filenames skipped (e.g. image-only, unreadable) with a short reason. */
  filesSkipped: { name: string; reason: string }[];
  truncated: boolean;
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

function xlsxToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    return `# Sheet: ${name}\n${csv}`;
  }).join("\n\n");
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
      return exportText(id, "text/csv");
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
      fields: "nextPageToken, files(id, name, mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

/**
 * Build the knowledge base for a folder: list every file (walking subfolders),
 * extract text from each, and concatenate with filename labels.
 */
export async function loadKnowledgeBase(
  folderId: string,
): Promise<KnowledgeBase> {
  const filesRead: string[] = [];
  const filesSkipped: { name: string; reason: string }[] = [];
  const sections: string[] = [];
  let totalChars = 0;
  let truncated = false;

  async function walk(id: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || truncated) return;
    const entries = await listFolder(id);

    for (const file of entries) {
      if (truncated) return;
      const name = file.name ?? "(untitled)";

      // Hard exclusion: confidential files/folders are never read (backstop to
      // keeping them out of the registered folder).
      if (isExcluded(name)) {
        filesSkipped.push({ name, reason: "excluded (confidential)" });
        continue;
      }

      if (file.mimeType === "application/vnd.google-apps.folder") {
        await walk(file.id!, depth + 1);
        continue;
      }

      try {
        const text = await extractFile(file);
        if (text === null || text.trim() === "") {
          filesSkipped.push({ name, reason: "no readable text" });
          continue;
        }
        const comments = await fetchComments(file.id!);
        const section = `===== FILE: ${name} =====\n${text.trim()}\n${comments}`;
        if (totalChars + section.length > MAX_KB_CHARS) {
          truncated = true;
          filesSkipped.push({ name, reason: "skipped: size limit reached" });
          break;
        }
        sections.push(section);
        filesRead.push(name);
        totalChars += section.length;
      } catch (err) {
        filesSkipped.push({
          name,
          reason: `read error: ${(err as Error).message}`,
        });
      }
    }
  }

  await walk(folderId, 0);

  return {
    text: sections.join("\n"),
    filesRead,
    filesSkipped,
    truncated,
  };
}

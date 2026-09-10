/**
 * Files a team member attaches to one question (a screenshot of a buyer's
 * email, a spreadsheet they were sent). They are read for that answer only and
 * never stored, so they ride in the uncached tail of the prompt.
 */

import mammoth from "mammoth";
import type { Doc } from "./anthropic";
import { xlsxToText } from "./drive";

export const ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024 };

type ImageMediaType = Extract<Doc, { kind: "image" }>["mediaType"];

const IMAGE_MIMES: ImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

// Browsers often send an empty or generic type for xlsx/csv, so the extension
// is the fallback for every branch below.
const IMAGE_EXTS: Record<string, ImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** One uploaded file as a document, or null if Hermes cannot read it. */
export async function attachmentToDoc(file: File): Promise<Doc | null> {
  if (file.size > ATTACHMENT_LIMITS.maxBytes) return null;

  const title = file.name || "attachment";
  const type = file.type;
  const ext = (title.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const data = Buffer.from(await file.arrayBuffer());

  const mediaType = IMAGE_MIMES.find((m) => m === type) ?? IMAGE_EXTS[ext];
  if (mediaType) return { kind: "image", title, data, mediaType };

  // Always native: attachments are small and usually screenshots anyway.
  if (type === "application/pdf" || ext === "pdf") {
    return { kind: "pdf", title, data };
  }

  let text: string;
  const spreadsheet =
    ["xlsx", "xls", "csv"].includes(ext) || /spreadsheet|excel|csv/.test(type);
  if (spreadsheet) {
    // SheetJS reads CSV from a buffer too, so one path covers all three.
    text = xlsxToText(data);
  } else if (ext === "docx" || type.endsWith("wordprocessingml.document")) {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else if (type.startsWith("text/") || ext === "txt" || ext === "md") {
    text = data.toString("utf8");
  } else {
    return null;
  }

  text = text.trim();
  return text ? { kind: "text", title, text } : null;
}

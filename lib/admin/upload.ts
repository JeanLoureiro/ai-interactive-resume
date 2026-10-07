import type { ResumeFormat } from "../resume/extract";

/** Vercel rejects request bodies over 4.5MB, so the cap leaves room for the multipart envelope. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 415,
  ) {
    super(message);
  }
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

/**
 * The file's type, decided by its content and its name together. A name alone lies easily, and a
 * PDF renamed to .md would otherwise be read as text and handed to the model as garbage.
 */
export function detectUploadFormat(fileName: string, bytes: Uint8Array): ResumeFormat {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("That file is over 4MB.", 413);
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (extension === "docx" && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "docx"; // ZIP
  if (extension === "md") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return "md";
    } catch {
      // fall through: not valid UTF-8 text
    }
  }
  throw new UploadError("Upload a .pdf, .docx or .md resume. The file's contents must match its extension.", 415);
}

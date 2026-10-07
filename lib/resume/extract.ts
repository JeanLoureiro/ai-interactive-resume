import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export type ResumeFormat = "pdf" | "docx" | "md";

/** From a file name. Phase 3b's upload checks the file's signature as well, since names lie. */
export function formatFromName(fileName: string): ResumeFormat {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "pdf" || extension === "docx" || extension === "md") return extension;
  throw new Error(`Unsupported resume file "${fileName}". Use a .pdf, .docx or .md file.`);
}

/**
 * Plain text out of a resume file. Deterministic: no model involved.
 *
 * PDF text from designed fonts often comes back with broken ligatures ("producHon"); that is
 * expected, and the ingest guard is built to tolerate it.
 */
export async function extractResumeText(bytes: Uint8Array, format: ResumeFormat): Promise<string> {
  switch (format) {
    case "pdf": {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return text;
    }
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value;
    }
    case "md":
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}

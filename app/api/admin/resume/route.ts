import { saveDraft } from "@/lib/admin/drafts";
import { guardAdminRequest } from "@/lib/admin/http";
import { detectUploadFormat, UploadError } from "@/lib/admin/upload";
import { getResumeModel } from "@/lib/config";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { getLlmProvider, GenerationError } from "@/lib/llm";
import { resumeToUnits } from "@/lib/resume";

export const runtime = "nodejs";
/** Structuring a resume takes about 30 seconds with the default model; leave generous headroom. */
export const maxDuration = 300;

/**
 * Upload -> draft. The file is read into memory, turned into units and discarded; only the units
 * and the guard's report are stored, and nothing goes live until the owner publishes.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = guardAdminRequest(request);
  if (refused) return refused;
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "Uploading needs a database. Set DATABASE_URL and run pnpm db:setup." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return Response.json({ error: "Choose a resume file to upload." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = detectUploadFormat(file.name, bytes);
    const { units, report } = await resumeToUnits(bytes, format, {
      provider: getLlmProvider,
      model: getResumeModel(),
      retrievedAt: new Date().toISOString().slice(0, 10),
    });
    if (units.length === 0) {
      return Response.json({ error: "Nothing in that file could be verified as resume content.", report }, { status: 422 });
    }
    await saveDraft(getDb(), { units, report, fileName: file.name });
    return Response.json({ ok: true, units: units.length, dropped: report.dropped.length });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof GenerationError) {
      return Response.json({ error: "The model could not process the resume. Try again in a moment." }, { status: 502 });
    }
    console.error("resume upload failed:", error);
    return Response.json({ error: "The resume could not be read." }, { status: 422 });
  }
}

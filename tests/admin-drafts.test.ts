import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { diffCvUnits, getDraft, publishDraft, saveDraft } from "../lib/admin/drafts";
import { detectUploadFormat, MAX_UPLOAD_BYTES } from "../lib/admin/upload";
import { buildKnowledgeBase } from "../lib/knowledge";
import { createPostgresKnowledgeStore, jsonKnowledgeStore, replaceKnowledge, type Db } from "../lib/db/knowledge-store";
import type { KnowledgeUnit } from "../lib/models";
import type { ResumeReport } from "../lib/resume";

const snapshot = buildKnowledgeBase(await jsonKnowledgeStore.load());
const report: ResumeReport = { path: "model", dropped: [], removedContacts: { emails: 1, phones: 1 }, inputTokens: 1, outputTokens: 1 };
const cvUnit = (id: string, text: string): KnowledgeUnit => ({ id, source: "cv", unitType: "project", title: id, text, retrievedAt: "2026-10-07" });

let db: Db;
beforeEach(async () => {
  const raw = drizzle(new PGlite());
  await migrate(raw, { migrationsFolder: "drizzle" });
  db = raw as unknown as Db;
  // Live data without conflicts, so a new resume's different ids are publishable.
  await replaceKnowledge(db, snapshot.units, []);
});

const liveUnits = async () => buildKnowledgeBase(await createPostgresKnowledgeStore(db).load()).units;

describe("drafts and publishing", () => {
  it("publishes a draft's CV units and keeps LinkedIn and GitHub units", async () => {
    await saveDraft(db, { units: [cvUnit("cv:new-project", "Built a thing.")], report, fileName: "resume.pdf" });
    await publishDraft(db);
    const units = await liveUnits();
    expect(units.filter((unit) => unit.source === "cv").map((unit) => unit.id)).toEqual(["cv:new-project"]);
    expect(units.filter((unit) => unit.source !== "cv")).toHaveLength(snapshot.units.filter((unit) => unit.source !== "cv").length);
    expect(await getDraft(db)).toBeUndefined();
  });

  it("refuses to publish when a known conflict would dangle, and changes nothing", async () => {
    await replaceKnowledge(db, snapshot.units, snapshot.conflicts);
    await saveDraft(db, { units: [cvUnit("cv:new-project", "Built a thing.")], report, fileName: "resume.pdf" });
    await expect(publishDraft(db)).rejects.toThrow(/references unknown knowledge unit/);
    expect((await liveUnits()).length).toBe(snapshot.units.length);
    expect(await getDraft(db)).toBeDefined();
  });

  it("stores units and the report, and has nowhere to store the file", async () => {
    await saveDraft(db, { units: [cvUnit("cv:a", "A.")], report, fileName: "resume.pdf" });
    const columns = Object.keys((await getDraft(db))!);
    expect(columns.sort()).toEqual(["createdAt", "fileName", "report", "units"]);
  });

  it("diffs CV units by id, ignoring retrieval dates", () => {
    const live = [cvUnit("cv:same", "Same."), cvUnit("cv:edited", "Old."), cvUnit("cv:gone", "Gone.")];
    const draft = [{ ...cvUnit("cv:same", "Same."), retrievedAt: "2027-01-01" }, cvUnit("cv:edited", "New."), cvUnit("cv:new", "New.")];
    const diff = diffCvUnits(live, draft);
    expect(diff.unchanged).toBe(1);
    expect(diff.added.map((unit) => unit.id)).toEqual(["cv:new"]);
    expect(diff.removed.map((unit) => unit.id)).toEqual(["cv:gone"]);
    expect(diff.changed.map(({ after }) => after.id)).toEqual(["cv:edited"]);
  });
});

describe("upload checks", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  it("accepts a file whose contents match its extension", () => {
    expect(detectUploadFormat("Resume.PDF", pdf)).toBe("pdf");
    expect(detectUploadFormat("cv.md", new TextEncoder().encode("# Ada\n"))).toBe("md");
  });
  it("rejects a renamed file, an unknown type, and an oversize file", () => {
    expect(() => detectUploadFormat("resume.docx", pdf)).toThrow(/must match/);
    expect(() => detectUploadFormat("resume.exe", pdf)).toThrow(/must match/);
    expect(() => detectUploadFormat("resume.pdf", new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow(/4MB/);
  });
});

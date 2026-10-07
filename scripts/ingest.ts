/**
 * Builds data/knowledge-units.json from every registered source adapter.
 *
 * Run with `pnpm ingest`. The output is committed: the repo must be runnable and reviewable without
 * network access, and a reviewer should be able to read exactly what the assistant can see without
 * running anything at all.
 *
 * `--offline` skips network-backed adapters and keeps their existing units, so a LinkedIn or GitHub
 * outage cannot silently empty the knowledge base.
 */
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { KnowledgeUnitSchema, type KnowledgeUnit } from "../lib/models";
import type { SourceAdapter } from "../lib/sources/types";
import { cvAdapter } from "../lib/sources/cv";
import { createLinkedinAdapter } from "../lib/sources/linkedin";
import { createGithubAdapter } from "../lib/sources/github";
import { getSubject } from "../lib/config";

const OUTPUT = path.join(process.cwd(), "data", "knowledge-units.json");

/** The CV is always a source; LinkedIn and GitHub only when their env vars are set. */
function configuredAdapters(): SourceAdapter[] {
  const { linkedinProfile, githubUsername } = getSubject();
  return [
    cvAdapter,
    ...(linkedinProfile ? [createLinkedinAdapter(linkedinProfile)] : []),
    ...(githubUsername ? [createGithubAdapter(githubUsername)] : []),
  ];
}
const NETWORK_ADAPTERS = new Set<string>(["linkedin", "github"]);

async function readExisting(): Promise<KnowledgeUnit[]> {
  try {
    return KnowledgeUnitSchema.array().parse(JSON.parse(await readFile(OUTPUT, "utf8")));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const existing = await readExisting();
  const units: KnowledgeUnit[] = [];

  for (const adapter of configuredAdapters()) {
    if (offline && NETWORK_ADAPTERS.has(adapter.name)) {
      const kept = existing.filter((u) => u.source === adapter.name);
      console.log(`  ${adapter.name.padEnd(9)} skipped (offline), kept ${kept.length} existing units`);
      units.push(...kept);
      continue;
    }
    try {
      const loaded = await adapter.load();
      console.log(`  ${adapter.name.padEnd(9)} ${loaded.length} units`);
      units.push(...loaded);
    } catch (error) {
      const kept = existing.filter((u) => u.source === adapter.name);
      // A failing adapter must not silently shrink the knowledge base — that would look like the
      // assistant "forgetting" facts, with no error anyone would notice until an answer went wrong.
      console.warn(
        `  ${adapter.name.padEnd(9)} FAILED (${error instanceof Error ? error.message : String(error)}) — keeping ${kept.length} existing units`,
      );
      units.push(...kept);
    }
  }

  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.id)) {
      throw new Error(
        `Duplicate knowledge unit id "${unit.id}". Ids are cited in answers and referenced by eval gold labels, so they must be unique and stable.`,
      );
    }
    seen.add(unit.id);
  }

  const parsed = KnowledgeUnitSchema.array().parse(units);
  await writeFile(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  console.log(`\n${parsed.length} units -> ${path.relative(process.cwd(), OUTPUT)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

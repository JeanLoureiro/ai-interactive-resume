import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../lib/db/knowledge-store";
import {
  addOwnerSuggestion,
  countQuestion,
  listSuggestions,
  loadHistory,
  loadThread,
  purgeExpired,
  saveTurn,
  setSuggestionApproved,
} from "../lib/memory";
import type { AssistantResponse } from "../lib/models";
import { consumeRateLimit, resetMemoryRateLimits } from "../lib/rate-limit";

let db: Db;
beforeEach(async () => {
  const raw = drizzle(new PGlite());
  await migrate(raw, { migrationsFolder: "drizzle" });
  db = raw as unknown as Db;
  resetMemoryRateLimits();
});

const response = (answerText: string): AssistantResponse => ({
  status: "answered",
  answerText,
  claims: [],
  retrieved: [],
  conflicts: [],
  diagnostics: { model: "m", latencyMs: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, invalidSourceIds: [], rankedSourceIds: [] },
});

describe("conversations", () => {
  it("returns the last turns oldest first, and the full thread for a reload", async () => {
    for (let i = 1; i <= 8; i++) {
      await saveTurn(db, "c1", `q${i}`, response(`a${i}`));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect((await loadHistory(db, "c1")).map((turn) => turn.question)).toEqual(["q3", "q4", "q5", "q6", "q7", "q8"]);
    const thread = await loadThread(db, "c1");
    expect(thread).toHaveLength(8);
    expect(thread[0]!.response.answerText).toBe("a1");
    expect(await loadHistory(db, "someone-else")).toEqual([]);
  });

  it("deletes conversations after the retention period, keeping recent ones", async () => {
    await saveTurn(db, "old", "q", response("a"));
    await saveTurn(db, "new", "q", response("a"));
    await db.execute(`update conversations set updated_at = now() - interval '91 days' where id = 'old'` as never);
    await purgeExpired(db, 90);
    expect(await loadThread(db, "old")).toEqual([]);
    expect(await loadThread(db, "new")).toHaveLength(1);
  });
});

describe("suggestions", () => {
  it("counts a visitor question once however it is typed, and hides it until approved", async () => {
    await countQuestion(db, "Where does Jean work now?");
    await countQuestion(db, "where does jean work now");
    const [candidate] = await listSuggestions(db, { approvedOnly: false });
    expect(candidate).toMatchObject({ text: "Where does Jean work now?", timesAsked: 2, approved: false, origin: "visitor" });
    expect(await listSuggestions(db, { approvedOnly: true })).toEqual([]);

    await setSuggestionApproved(db, candidate!.id, true);
    expect((await listSuggestions(db, { approvedOnly: true })).map((s) => s.text)).toEqual(["Where does Jean work now?"]);
  });

  it("approves the owner's own suggestions immediately and orders by how often they are asked", async () => {
    await addOwnerSuggestion(db, "Has Jean built a chatbot?");
    await addOwnerSuggestion(db, "What did Jean do at KPMG?");
    await countQuestion(db, "What did Jean do at KPMG?");
    expect((await listSuggestions(db, { approvedOnly: true })).map((s) => s.text)).toEqual([
      "What did Jean do at KPMG?",
      "Has Jean built a chatbot?",
    ]);
  });
});

describe("rate limit", () => {
  const at = new Date("2026-10-08T10:15:00Z");
  it.each([["postgres", () => db], ["memory", () => undefined]])("allows the limit per hour, then refuses until the hour ends (%s)", async (_, getDb) => {
    for (let i = 0; i < 3; i++) expect((await consumeRateLimit(getDb(), "203.0.113.7", 3, at)).allowed).toBe(true);
    const refused = await consumeRateLimit(getDb(), "203.0.113.7", 3, at);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 45 * 60 });
    expect((await consumeRateLimit(getDb(), "203.0.113.8", 3, at)).allowed).toBe(true);
    expect((await consumeRateLimit(getDb(), "203.0.113.7", 3, new Date("2026-10-08T11:00:01Z"))).allowed).toBe(true);
  });

  it("stores a hash, never the address", async () => {
    await consumeRateLimit(db, "203.0.113.7", 3, at);
    const rows = await db.execute(`select key from rate_limits` as never);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });
});

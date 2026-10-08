import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { ConversationTurn } from "./conversation";
import { MAX_HISTORY_TURNS } from "./conversation";
import type { Db } from "./db/knowledge-store";
import { conversations, messages, rateLimits, suggestions } from "./db/schema";
import type { AssistantResponse } from "./models";

/** Conversations, suggested questions and their retention. Postgres only: without a database there
 *  is no memory, and each question stands alone. */

export const newConversationId = () => randomUUID();

/** Turns of a conversation, oldest first, at most MAX_HISTORY_TURNS: what the next question sees. */
export async function loadHistory(db: Db, conversationId: string): Promise<ConversationTurn[]> {
  const rows = await db
    .select({ question: messages.question, answer: messages.answerText })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY_TURNS);
  return rows.reverse();
}

/** The whole thread with full responses, so a reload shows answers with their sources. */
export async function loadThread(db: Db, conversationId: string): Promise<Array<{ question: string; response: AssistantResponse }>> {
  const rows = await db
    .select({ question: messages.question, response: messages.response })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(100);
  return rows.map((row) => ({ question: row.question, response: row.response as AssistantResponse }));
}

export async function saveTurn(
  db: Db,
  conversationId: string,
  question: string,
  response: AssistantResponse,
  inviteId?: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(conversations)
    .values({ id: conversationId, inviteId: inviteId ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: conversations.id, set: { updatedAt: now } });
  await db.insert(messages).values({
    id: randomUUID(),
    conversationId,
    question,
    answerText: response.answerText,
    status: response.status,
    response,
    createdAt: now,
  });
}

/** "Where does Jean work now?" and "where does jean work now" count as the same question. */
export const normalizeQuestion = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Counts a visitor question that was answered from sources. It is a candidate only: other visitors
 * see it after the owner approves it, never before.
 */
export async function countQuestion(db: Db, question: string): Promise<void> {
  const normalized = normalizeQuestion(question);
  if (!normalized) return;
  await db
    .insert(suggestions)
    .values({ id: randomUUID(), text: question.trim(), normalized, origin: "visitor", approved: false, timesAsked: 1 })
    .onConflictDoUpdate({ target: suggestions.normalized, set: { timesAsked: sql`${suggestions.timesAsked} + 1` } });
}

export interface Suggestion {
  id: string;
  text: string;
  origin: "owner" | "visitor";
  approved: boolean;
  timesAsked: number;
}

export async function listSuggestions(db: Db, { approvedOnly }: { approvedOnly: boolean }): Promise<Suggestion[]> {
  const rows = await db
    .select()
    .from(suggestions)
    .where(approvedOnly ? eq(suggestions.approved, true) : undefined)
    .orderBy(desc(suggestions.timesAsked), asc(suggestions.createdAt));
  return rows.map(({ id, text, origin, approved, timesAsked }) => ({
    id,
    text,
    origin: origin === "owner" ? "owner" : "visitor",
    approved,
    timesAsked,
  }));
}

/** The owner's own suggestion: approved on creation. Re-adding an existing question approves it. */
export async function addOwnerSuggestion(db: Db, text: string): Promise<void> {
  const normalized = normalizeQuestion(text);
  if (!normalized) return;
  await db
    .insert(suggestions)
    .values({ id: randomUUID(), text: text.trim(), normalized, origin: "owner", approved: true })
    .onConflictDoUpdate({ target: suggestions.normalized, set: { approved: true } });
}

export async function setSuggestionApproved(db: Db, id: string, approved: boolean): Promise<void> {
  await db.update(suggestions).set({ approved }).where(eq(suggestions.id, id));
}

export async function removeSuggestion(db: Db, id: string): Promise<void> {
  await db.delete(suggestions).where(eq(suggestions.id, id));
}

/**
 * Daily retention: conversations (and their messages) older than `retentionDays` since their last
 * question, visitor questions never approved in that time, and rate-limit rows older than a day.
 */
export async function purgeExpired(db: Db, retentionDays: number, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  await db.delete(conversations).where(lt(conversations.updatedAt, cutoff));
  await db
    .delete(suggestions)
    .where(and(eq(suggestions.origin, "visitor"), eq(suggestions.approved, false), lt(suggestions.createdAt, cutoff)));
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
}

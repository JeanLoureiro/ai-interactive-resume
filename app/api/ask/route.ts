import { z } from "zod";
import { countInviteQuestion, resolveAccess } from "@/lib/access";
import { getRateLimitPerHour } from "@/lib/config";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { clientAddress } from "@/lib/http";
import { countQuestion, loadHistory, newConversationId, saveTurn } from "@/lib/memory";
import { ask } from "@/lib/pipeline";
import { consumeRateLimit } from "@/lib/rate-limit";
import { conversationCookie, readConversationId } from "@/lib/visitor";

/** Node runtime, not edge: the Anthropic SDK and the bundled knowledge base both want it, and Fluid
 *  Compute is the default anyway. */
export const runtime = "nodejs";

const RequestSchema = z.object({
  // Capped because this is the one untrusted input in the system and long inputs cost real tokens.
  // Generous enough that no genuine interview question is refused.
  question: z.string().trim().min(1, "Ask a question.").max(2000, "That question is too long."),
});

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const { question } = parsed.data;

  try {
    // Without a database there is no memory: each question stands alone, and the rate limit is per
    // server instance. History is only ever loaded here, server-side, so it cannot be forged.
    const db = isDatabaseConfigured() ? getDb() : undefined;

    const access = await resolveAccess(request, db);
    if (!access.allowed) {
      return Response.json({ error: "An invite code is needed to ask questions.", gate: true }, { status: 401 });
    }

    const limit = await consumeRateLimit(db, clientAddress(request), getRateLimitPerHour());
    if (!limit.allowed) {
      const minutes = Math.ceil(limit.retryAfterSeconds / 60);
      return Response.json(
        { error: `That is a lot of questions in one hour. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      );
    }

    const existing = readConversationId(request);
    const history = db && existing ? await loadHistory(db, existing) : [];
    const response = await ask(question, { history });
    if (!db) return Response.json(response);

    const conversationId = existing ?? newConversationId();
    await saveTurn(db, conversationId, question, response, access.inviteId);
    if (access.inviteId) await countInviteQuestion(db, access.inviteId);
    // Only standalone questions that were answered from sources become suggestion candidates: a
    // follow-up ("And before that?") means nothing out of context, and a refusal is a poor first click.
    if (response.status === "answered" && history.length === 0) await countQuestion(db, question);
    return Response.json(response, { headers: { "set-cookie": conversationCookie(conversationId) } });
  } catch (error) {
    // The pipeline handles provider failures internally and returns a response; reaching here means
    // something structural is wrong (missing API key, corrupt knowledge base). The detail is logged
    // server-side and deliberately not returned — it would leak configuration to the client.
    console.error("ask pipeline failed:", error);
    return Response.json(
      { error: "The assistant is misconfigured and cannot answer right now." },
      { status: 500 },
    );
  }
}

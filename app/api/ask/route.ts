import { z } from "zod";
import { ask } from "@/lib/pipeline";

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

  try {
    const response = await ask(parsed.data.question);
    return Response.json(response);
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

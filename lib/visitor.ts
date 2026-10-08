import { clearCookie, readCookie, setCookie } from "./http";
import { getRetentionDays } from "./config";

/** The anonymous conversation id. Lax, so it survives arriving from a link to the page. */
export const CONVERSATION_COOKIE = "conversation_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed id from the cookie, or undefined. Anything else is ignored, never queried. */
export function readConversationId(request: Request): string | undefined {
  const value = readCookie(request, CONVERSATION_COOKIE);
  return value && UUID.test(value) ? value : undefined;
}

export const conversationCookie = (id: string) => setCookie(CONVERSATION_COOKIE, id, getRetentionDays() * 86_400, "Lax");
export const clearedConversationCookie = () => clearCookie(CONVERSATION_COOKIE, "Lax");

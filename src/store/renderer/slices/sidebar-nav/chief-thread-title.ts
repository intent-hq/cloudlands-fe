/**
 * Chief thread title derivation.
 *
 * The single shared derivation of the sidebar-visible chief thread title:
 * the first user message's text, falling back to the session name only when
 * it is a real (non-placeholder) name, and to `DEFAULT_CHIEF_THREAD_TITLE`
 * otherwise. Used by both the sidebar-nav selectors and the chat-send rename
 * trigger (`chat-send-service`) — keep it dependency-light per repo
 * convention (no stores, services, or side effects).
 */
import { extractAllContent, type AgentSession } from "$shared/types";
import { DEFAULT_CHIEF_THREAD_TITLE } from "./sidebar-nav-types";

export function getChiefThreadTitle(
  session: Pick<AgentSession, "messages" | "name">,
): string {
  const firstUserMessage = session.messages.find((message) => message.role === "user");
  const firstMessage = firstUserMessage ?? session.messages[0];
  const text = firstMessage ? extractAllContent(firstMessage).trim() : "";
  const fallbackName = session.name?.trim();
  if (!fallbackName || fallbackName === "Chief of Staff" || fallbackName.startsWith("New thread ")) {
    return text || DEFAULT_CHIEF_THREAD_TITLE;
  }
  return text || fallbackName;
}

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

/**
 * True when `name` is one of the creation placeholders a chief thread can
 * carry before its first real rename: empty/blank, the ChiefCard placeholder
 * (`DEFAULT_CHIEF_THREAD_TITLE`), the legacy "Chief of Staff" name, or a
 * generated "New thread …" name. Shared by the title derivation below and
 * the chat-send rename trigger's "daemon-side name is still the placeholder"
 * guard (monorepo#745).
 */
export function isPlaceholderChiefThreadName(name: string | undefined | null): boolean {
  const trimmed = name?.trim();
  return (
    !trimmed ||
    trimmed === DEFAULT_CHIEF_THREAD_TITLE ||
    trimmed === "Chief of Staff" ||
    trimmed.startsWith("New thread ")
  );
}

export function getChiefThreadTitle(
  session: Pick<AgentSession, "messages" | "name">,
): string {
  const firstUserMessage = session.messages.find((message) => message.role === "user");
  const firstMessage = firstUserMessage ?? session.messages[0];
  const text = firstMessage ? extractAllContent(firstMessage).trim() : "";
  const fallbackName = session.name?.trim();
  if (!fallbackName || isPlaceholderChiefThreadName(fallbackName)) {
    return text || DEFAULT_CHIEF_THREAD_TITLE;
  }
  return text || fallbackName;
}

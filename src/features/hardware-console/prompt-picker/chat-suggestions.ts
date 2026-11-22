/**
 * The focused chat's suggested prompts, shared with the joystick radial
 * picker. ChatPanel publishes its visible suggestions (and how to send one)
 * while it is the focused, active chat; the picker reads them when the stick
 * engages. Last publisher wins; a stale release never clears a newer chat.
 *
 * A chat that is the only one on screen (Home's preview) publishes as a
 * fallback: it serves the picker only while no chat holds focus.
 */

export interface ChatSuggestionSource {
  /** Stable identity of the publishing chat; re-publishes keep the same id. */
  ownerId: string;
  prompts: readonly string[];
  /** Send a suggestion exactly like clicking it in the chat. */
  send: (prompt: string) => void;
  /** Insert text into this chat's composer without sending. */
  insert?: (text: string) => boolean;
  /** Fallback sources only: false while the chat is hidden or inert. */
  available?: () => boolean;
}

interface Publication {
  source: ChatSuggestionSource;
  fallback: boolean;
}

let publications: Publication[] = [];

/** Publish the focused chat's suggestions. Returns the release function. */
export function publishFocusedChatSuggestions(
  source: ChatSuggestionSource,
  options: { fallback?: boolean } = {},
): () => void {
  const publication: Publication = { source, fallback: options.fallback === true };
  publications = [...publications, publication];
  return () => {
    publications = publications.filter((entry) => entry !== publication);
  };
}

export function getFocusedChatSuggestions(): ChatSuggestionSource | null {
  const focused = publications.findLast((entry) => !entry.fallback);
  if (focused) return focused.source;
  const fallback = publications.findLast(
    (entry) => entry.fallback && (entry.source.available?.() ?? true),
  );
  return fallback?.source ?? null;
}

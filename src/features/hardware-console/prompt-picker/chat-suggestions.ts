/**
 * The focused chat's suggested prompts, shared with the joystick radial
 * picker. ChatPanel publishes its visible suggestions (and how to send one)
 * while it is the focused, active chat; the picker reads them when the stick
 * engages. Last publisher wins; a stale release never clears a newer chat.
 */

export interface ChatSuggestionSource {
  prompts: readonly string[];
  /** Send a suggestion exactly like clicking it in the chat. */
  send: (prompt: string) => void;
}

let current: ChatSuggestionSource | null = null;

/** Publish the focused chat's suggestions. Returns the release function. */
export function publishFocusedChatSuggestions(source: ChatSuggestionSource): () => void {
  current = source;
  return () => {
    if (current === source) current = null;
  };
}

export function getFocusedChatSuggestions(): ChatSuggestionSource | null {
  return current;
}

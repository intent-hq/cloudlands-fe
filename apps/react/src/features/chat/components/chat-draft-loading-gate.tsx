// Source: src/lib/components/chat/ChatDraftLoadingGate.svelte.
import { m } from '$shared/paraglide/messages.js';

/** Shown while the composer draft restore is in flight and text entry is blocked. */
export function ChatDraftLoadingGate() {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source live loading status while draft restore blocks text entry.
      role="status"
      className="px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="chat-draft-loading-gate"
    >
      <span>{m.chat_draftGate_loading_label()}</span>
    </div>
  );
}

export default ChatDraftLoadingGate;

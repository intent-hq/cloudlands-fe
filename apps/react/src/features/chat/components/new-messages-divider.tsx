// Source: src/lib/components/chat/NewMessagesDivider.svelte.
import { m } from '$shared/paraglide/messages.js';

/** Presentation-only marker; the transcript owner supplies its position. */
export function NewMessagesDivider() {
  return (
    <div
      data-new-messages-divider=""
      className="type-caption font-family-child my-6 flex items-center gap-2 px-2"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The source labelled separator contains text and divider lines, which an hr cannot contain.
      role="separator"
      aria-label={m.chat_newMessagesDivider_label()}
    >
      <div className="h-px flex-1 bg-border" />
      <span className="whitespace-nowrap px-1 font-medium text-foreground">
        {m.chat_newMessagesDivider_label()}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default NewMessagesDivider;

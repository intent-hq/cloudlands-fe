// Source: src/lib/components/chat/QuestionsDismissedNotice.svelte.
import { ChatSlashIcon } from '@phosphor-icons/react';
import { m } from '$shared/paraglide/messages.js';

export interface QuestionsDismissedNoticeProps {
  /** Full delivered message text, surfaced as a hover title. */
  title?: string;
}

export function QuestionsDismissedNotice({ title }: QuestionsDismissedNoticeProps) {
  return (
    <div
      className="questions-dismissed-notice flex items-center gap-3 my-4 w-full"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source transcript live status region, not a form result.
      role="status"
      title={title}
    >
      <div className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
        <ChatSlashIcon weight="regular" aria-hidden="true" className="w-3 h-3 flex-shrink-0" />
        {m.chat_questionsDismissedNotice_dismissed_label()}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default QuestionsDismissedNotice;

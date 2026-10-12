// Source: src/lib/components/chat/AutoUnarchivedNotice.svelte.
import { PackageIcon } from '@phosphor-icons/react';
import { m } from '$shared/paraglide/messages.js';

export interface AutoUnarchivedNoticeProps {
  /** Full persisted message text, surfaced as a hover title. */
  title?: string;
}

export function AutoUnarchivedNotice({ title }: AutoUnarchivedNoticeProps) {
  return (
    <div
      className="auto-unarchived-notice my-4 flex w-full items-center gap-3"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source transcript live status region.
      role="status"
      title={title}
    >
      <div className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
        <PackageIcon weight="regular" className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          {m.chat_autoUnarchivedNotice_unarchived_label()}
        </span>
      </span>
      <div className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}

export default AutoUnarchivedNotice;

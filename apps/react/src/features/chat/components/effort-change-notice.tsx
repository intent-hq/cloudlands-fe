// Source: src/lib/components/chat/EffortChangeNotice.svelte.
import { ArrowsLeftRightIcon } from '@phosphor-icons/react';
import { m } from '$shared/paraglide/messages.js';
import {
  formatEffortChangeLabel,
  type EffortChangeNoticeInfo,
} from '$lib/components/chat/effort-change-notice';

export type { EffortChangeNoticeInfo } from '$lib/components/chat/effort-change-notice';

export interface EffortChangeNoticeProps {
  notice: EffortChangeNoticeInfo;
  fallbackText?: string;
}

export function EffortChangeNotice({
  notice,
  fallbackText = m.chat_effortChangeNotice_fallback_label(),
}: EffortChangeNoticeProps) {
  const label = formatEffortChangeLabel(notice, fallbackText);

  return (
    <div
      className="my-4 flex w-full min-w-0 items-center gap-3"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source transcript live status region.
      role="status"
    >
      <div className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
        <ArrowsLeftRightIcon
          weight="regular"
          className="mt-0.5 h-3 w-3 flex-shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <div className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}

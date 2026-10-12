// Source: src/lib/components/chat/TurnFailureNotice.svelte.
import { useId, useState } from 'react';
import type { FailureRecord } from '../../../../../../src/features/agent/utils/failure-summary';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { formatNumber, formatDateTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

export interface TurnFailureNoticeProps {
  reason?: string;
  records?: readonly FailureRecord[];
  class?: string;
  className?: string;
}

export function TurnFailureNotice({
  reason = '',
  records,
  class: sourceClass = '',
  className = sourceClass,
}: TurnFailureNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const entries = records ?? [{ messageId: '', reason, timestamp: '' }];
  const label =
    entries.length === 1
      ? m.chat_failureRecovery_recorded_one()
      : m.chat_failureRecovery_recorded_many({ count: formatNumber(entries.length) });
  const details = entries
    .map((record) => [record.timestamp, record.reason].filter(Boolean).join('\n'))
    .join('\n\n');

  return (
    <div
      className={`turn-failure-notice type-caption min-w-0 py-1 text-muted-foreground ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {label}
        </Button>
        {expanded && (
          <CopyButton text={details} size="sm" label={m.chat_failureRecovery_copyDetails_label()} />
        )}
      </div>
      {expanded && (
        <div
          id={id}
          className="max-h-64 overflow-y-auto"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll historical diagnostics, as in the source.
          tabIndex={0}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source named diagnostic scroll region.
          role="region"
          aria-label={m.chat_failureRecovery_details_label()}
        >
          {entries.map((record, index) => (
            <div
              key={record.messageId || index}
              className="py-2"
              data-failure-message-id={record.messageId || undefined}
            >
              {Boolean(record.timestamp) && (
                <time className="type-caption" dateTime={String(record.timestamp)}>
                  {formatDateTime(record.timestamp)}
                </time>
              )}
              <pre className="type-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
                {record.reason}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TurnFailureNotice;

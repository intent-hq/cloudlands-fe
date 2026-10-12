// Source: src/lib/components/chat/ChatNotice.svelte.
import { useRef } from 'react';
import { RelativeTime } from '@/components/ui/relative-time';
import { usePresenceTransition } from '@/lib/motion';
import { OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import { chatDisclosureTransition } from './chat-motion';

export interface ChatNoticeProps {
  title: string;
  reason?: string;
  timestamp?: string;
  tone: 'danger' | 'warning';
  announce?: boolean;
  testIdPrefix?: string;
  className?: string;
  /** A presence-owning parent retains this notice until its source outro finishes. */
  present?: boolean;
  onExit?: () => void;
}

const noop = () => {};

export function ChatNotice({
  title,
  reason,
  timestamp,
  tone,
  announce = true,
  testIdPrefix = 'chat-notice',
  className = '',
  present = true,
  onExit = noop,
}: ChatNoticeProps) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, chatDisclosureTransition);

  return (
    <div
      ref={root}
      inert={!present}
      className={`mt-10 w-full min-w-0 max-w-full font-family-child ${tone === 'danger' ? 'text-danger' : 'text-warning-ink'} ${className}`}
      data-chat-notice=""
      data-testid={`${testIdPrefix}-banner`}
      role={announce ? 'alert' : undefined}
      aria-live={announce ? 'polite' : undefined}
    >
      <div
        className={`flex flex-col gap-1 pr-3 py-1.5 type-body ${OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}`}
      >
        <div
          className="flex items-start justify-between gap-3"
          data-testid={`${testIdPrefix}-header`}
        >
          <span
            className="min-w-0 break-words whitespace-pre-wrap"
            data-chat-notice-label=""
            data-testid={`${testIdPrefix}-label`}
          >
            {title}
          </span>
          {timestamp && (
            <RelativeTime
              date={timestamp}
              className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
            />
          )}
        </div>
        {reason && (
          <span
            className="break-words whitespace-pre-wrap text-muted-foreground"
            data-chat-notice-reason=""
            data-testid={`${testIdPrefix}-reason`}
          >
            {reason}
          </span>
        )}
      </div>
    </div>
  );
}

export default ChatNotice;

// Source: src/lib/components/chat/FailureDetails.svelte.
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { m } from '$shared/paraglide/messages.js';

export interface FailureDetailsProps {
  text: string;
  label?: string;
}

export function FailureDetails({
  text,
  label = m.chat_failureRecovery_details_label(),
}: FailureDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  return (
    <div className="min-w-0">
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
          <CopyButton text={text} size="sm" label={m.chat_failureRecovery_copyDetails_label()} />
        )}
      </div>
      {expanded && (
        <pre
          id={id}
          data-testid="failure-raw-details"
          className="type-caption mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll long diagnostics, as in the source.
          tabIndex={0}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve preformatted diagnostics as the source's named scroll region.
          role="region"
          aria-label={m.chat_failureRecovery_details_label()}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

export default FailureDetails;

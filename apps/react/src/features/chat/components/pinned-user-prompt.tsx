// Source: src/lib/components/chat/PinnedUserPrompt.svelte.
import { useId, useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import type { IconDefinition } from '$lib/icons/icon-definition';
import {
  USER_MESSAGE_SURFACE_CLASS,
  USER_MESSAGE_TEXT_CLASS,
} from '$lib/components/chat/user-message-surface';
import { SUBSCRIPTION_CARD_SURFACE_CLASS } from '$lib/components/chat/subscription-disclosure-classes';
import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

export interface PinnedUserPromptProps {
  text: string;
  surface?: 'user' | 'subscription';
  icon?: IconDefinition;
  /** Accepted for source compatibility; this display leaf does not read it. */
  workspace?: Workspace | null;
  onActivate: () => void;
}

export function PinnedUserPrompt({
  text,
  icon,
  surface = 'user',
  workspace: _workspace = null,
  onActivate,
}: PinnedUserPromptProps) {
  const descriptionId = useId();
  const label = useRef<HTMLSpanElement>(null);
  const titleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);

  useLayoutEffect(() => {
    if (!label.current) return;
    const action = truncatedTitle(label.current, undefined);
    titleAction.current = action;
    return () => {
      action?.destroy?.();
      titleAction.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    titleAction.current?.update?.(text);
  }, [text]);

  return (
    <Button
      variant="plain"
      type="button"
      data-testid="pinned-user-prompt"
      data-surface-role="pinned-user-prompt-bubble"
      className={`pointer-events-auto block h-auto min-h-9 w-full min-w-0 shrink whitespace-normal border-0 px-3! py-2! text-left font-normal ${surface === 'subscription' ? SUBSCRIPTION_CARD_SURFACE_CLASS : USER_MESSAGE_SURFACE_CLASS} focus-visible:ring-2`}
      style={{ transition: 'none' }}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate();
      }}
      aria-label={m.chat_stickyMessageHeader_scrollToPrevious_title()}
      aria-describedby={descriptionId}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon && (
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            <IconDefinitionIcon icon={icon} size={16} />
          </span>
        )}
        <span
          ref={label}
          data-testid="pinned-user-prompt-text"
          className={`block min-w-0 truncate whitespace-nowrap ${USER_MESSAGE_TEXT_CLASS}`}
        >
          {text}
        </span>
      </span>
      <span id={descriptionId} className="sr-only">
        {text}
      </span>
    </Button>
  );
}

export default PinnedUserPrompt;

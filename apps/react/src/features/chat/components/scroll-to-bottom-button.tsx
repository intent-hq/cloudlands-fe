// Source: src/lib/components/chat/ScrollToBottomButton.svelte.
import { ArrowDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';
import { CHAT_ICON_SIZE } from '$lib/components/chat/chat-icon-size';

export interface ScrollToBottomButtonProps {
  onClick: () => void;
  disabled?: boolean;
  floating?: boolean;
}

export function ScrollToBottomButton({
  onClick,
  disabled = false,
  floating = false,
}: ScrollToBottomButtonProps) {
  const label = m.chat_chatPanel_scrollToBottom_tooltip();

  return (
    <Button
      variant={floating ? 'outline' : 'ghost-light'}
      size={floating ? 'icon' : 'icon-sm'}
      className={floating ? 'rounded-full bg-background shadow-(--elevation-raised)' : undefined}
      data-testid={
        floating ? 'chat-floating-scroll-to-bottom-button' : 'chat-scroll-to-bottom-button'
      }
      onClick={onClick}
      disabled={disabled}
      data-icon-size={CHAT_ICON_SIZE.compact}
      aria-label={label}
      tooltip={label}
      tooltipSide={floating ? 'top' : 'bottom'}
      tooltipDelayDuration={300}
    >
      <ArrowDownIcon
        size={CHAT_ICON_SIZE.compact}
        weight="regular"
        aria-hidden="true"
        className="size-4!"
      />
    </Button>
  );
}

export default ScrollToBottomButton;

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { CopyFeedback } from '@/components/ui/copy-feedback';
import { logger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

export interface CopyButtonProps {
  text?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  onCopy?: () => void;
  copy?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  shortcut?: string;
  label?: string;
  copiedLabel?: string;
  'data-testid'?: string;
}

export function CopyButton({
  text,
  size = 'xs',
  className,
  disabled = false,
  onCopy,
  copy,
  shortcut,
  label = m.ui_copyButton_label(),
  copiedLabel = m.ui_linkTooltip_copied_label(),
  'data-testid': testId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) return;
    try {
      if (copy) await copy(event);
      else await navigator.clipboard.writeText(text ?? '');
      onCopy?.();
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('Failed to copy:', error);
    }
  }
  const feedbackLabel = copied ? copiedLabel : label;
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <Button
      variant="ghost"
      size={size === 'md' ? 'icon' : size === 'sm' ? 'icon-sm' : 'icon-xs'}
      iconOnly
      tooltip={feedbackLabel}
      tooltipShortcut={shortcut}
      tooltipDelayDuration={300}
      aria-label={feedbackLabel}
      disabled={disabled}
      className={className}
      onClick={handleCopy}
      data-testid={testId}
    >
      <CopyFeedback
        transitionKey={String(copied)}
        slot="copy-button-icon"
        className={
          copied
            ? 'flex items-center justify-center text-success'
            : 'flex items-center justify-center'
        }
        scale={0.7}
      >
        <Icon
          size={size === 'xs' ? '0.75em' : size === 'sm' ? '0.875em' : '1em'}
          weight="regular"
          aria-hidden="true"
        />
      </CopyFeedback>
    </Button>
  );
}

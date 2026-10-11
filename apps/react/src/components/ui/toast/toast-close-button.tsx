import { XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import './toast-close-button.css';

export interface ToastCloseButtonProps {
  onClick: () => void;
  ariaLabel: string;
  inline?: boolean;
}

export function ToastCloseButton({ onClick, ariaLabel, inline = false }: ToastCloseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      iconOnly
      className={cn('toast-close-btn', inline && 'toast-close-inline')}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <XIcon size={16} aria-hidden="true" />
    </Button>
  );
}

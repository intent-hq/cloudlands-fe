import type { HTMLAttributes } from 'react';
import { FormActions, type FormActionsProps } from '../form';
import { cn } from '@/lib/utils';

export interface ScreenFooterProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children'>, FormActionsProps {}

export function ScreenFooter({
  destructive,
  secondary,
  primary,
  hint,
  className,
  ...props
}: ScreenFooterProps) {
  return (
    <footer
      data-slot="screen-footer"
      className={cn('shrink-0 border-t border-border px-5 py-3', className)}
      {...props}
    >
      <FormActions destructive={destructive} secondary={secondary} primary={primary} hint={hint} />
    </footer>
  );
}

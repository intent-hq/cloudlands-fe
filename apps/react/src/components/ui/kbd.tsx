// Based on shadcn/ui kbd, customized to kbd/ShortcutChip.svelte.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function ShortcutChip({ className, style, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="shortcut-chip"
      className={cn(
        'type-caption shrink-0 font-normal leading-none text-shortcut-foreground',
        className,
      )}
      style={{ fontFamily: 'var(--font-ui)', ...style }}
      {...props}
    />
  );
}
export { ShortcutChip as Kbd };
export function KbdGroup({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
}

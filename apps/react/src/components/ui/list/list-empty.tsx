// Source: src/lib/components/ui/list/ListEmpty.svelte.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
export function ListEmpty({
  className,
  message = m.ui_list_empty_label(),
  children,
  ...props
}: ComponentProps<'div'> & { message?: string }) {
  return (
    <div
      {...props}
      data-slot="list-empty"
      className={cn(
        'type-caption flex min-h-28 items-center justify-start px-4 py-8 text-left text-muted-foreground',
        className,
      )}
    >
      {children ?? <p>{message}</p>}
    </div>
  );
}

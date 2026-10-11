// Source: src/lib/components/ui/inline-code/inline-code.svelte.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function InlineCode({ className, ...props }: ComponentProps<'code'>) {
  return (
    <code
      data-slot="inline-code"
      className={cn(
        'type-body rounded-(--radius-small) bg-muted px-1 py-0.5 font-mono text-foreground',
        className,
      )}
      {...props}
    />
  );
}
export { InlineCode as Root };

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function InputMessage({
  tone = 'helper',
  className,
  ...props
}: ComponentProps<'p'> & { tone?: 'helper' | 'error' }) {
  return (
    <p
      data-slot="input-message"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={tone === 'helper' ? 'polite' : undefined}
      className={cn(
        'type-caption mt-1.5 pl-0.5 motion-reduce:transition-none',
        tone === 'error' ? 'text-danger' : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

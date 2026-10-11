// Based on shadcn/ui label; recipe mirrors label.svelte.
import type { ComponentProps } from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useSize, type UiSize } from '@/components/ui/size-context';

export function Label({
  className,
  size,
  invalid = false,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root> & { size?: UiSize; invalid?: boolean }) {
  const density = useSize();
  const resolvedSize = size ?? density;
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-size={resolvedSize}
      data-invalid={invalid || undefined}
      className={cn(
        'type-caption flex min-w-0 select-none items-center font-medium tracking-normal text-muted-foreground transition-[color] duration-(--spring-fast) group-hover:text-foreground group-focus-within:text-foreground data-[state=hover]:text-foreground data-[state=focus]:text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-60 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60 group-data-[invalid=true]:text-danger data-[invalid=true]:text-danger motion-reduce:transition-none',
        resolvedSize === 'compact' ? 'gap-1.5' : 'gap-2',
        className,
      )}
      {...props}
    />
  );
}

// Based on shadcn/ui skeleton; shimmer matches skeleton.svelte.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import './skeleton.css';
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('skeleton-shimmer rounded-(--radius-small) bg-(--skeleton)', className)}
      {...props}
    />
  );
}

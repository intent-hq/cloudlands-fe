import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FormRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="form-row"
      className={cn(
        'grid min-w-0 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}

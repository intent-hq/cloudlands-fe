import type { ReactNode } from 'react';

export function TimelineDivider({ children }: { children?: ReactNode }) {
  return (
    <div className="relative -ml-1 mb-6 mt-2 w-full">
      <div className="absolute -left-0.5 -right-0.5 top-[13px] h-px bg-border dark:bg-border" />
      <div className="relative pl-5 flex flex-wrap gap-2 w-full">{children}</div>
    </div>
  );
}

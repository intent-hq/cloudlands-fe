import { IntentMarkLoader } from '@/components/ui/indicators';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '$lib/components/patterns/form/types';

export function UnsavedIndicator({
  status,
  label,
  className,
}: {
  status: SaveStatus;
  label?: string;
  className?: string;
}) {
  if (status === 'idle') return null;
  return (
    <span
      data-slot="unsaved-indicator"
      data-state={status}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-flex size-4 items-center justify-center text-muted-foreground transition-[opacity,transform,color] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
        status === 'saved' && 'text-emerald-500 animate-in fade-in zoom-in-75',
        status === 'error' && 'text-danger',
        className,
      )}
    >
      {status === 'saving' ? (
        <IntentMarkLoader size={10} />
      ) : status === 'saved' ? (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
          <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
    </span>
  );
}

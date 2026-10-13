import { useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { m } from '$shared/paraglide/messages.js';
import './home-loading.css';

export interface HomeLoadingProps {
  detail?: boolean;
  count?: number;
  view?: 'list' | 'board';
  grouped?: boolean;
  rows?: 'workspace' | 'integration' | 'compact';
}

export function HomeLoading({
  detail = false,
  count = 5,
  view = 'list',
  grouped = false,
  rows = 'workspace',
}: HomeLoadingProps) {
  const reduced = useSyncExternalStore(onReducedMotionChange, prefersReducedMotion, () => false);
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source block loading status and skeleton layout; this is not a form output.
      role="status"
      aria-label={m.home_integrations_loading()}
      className="min-h-0 min-w-0 flex-1 overflow-hidden"
      data-home-loading
      data-reduced={reduced}
    >
      <div
        aria-hidden="true"
        className={detail ? 'space-y-6 py-3' : rows === 'compact' ? '' : 'px-5 pb-4'}
      >
        {detail ? (
          <>
            <div className="space-y-3">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            {[0, 1].map((section) => (
              <div key={section} className="space-y-3">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </>
        ) : view === 'board' ? (
          <div className="grid grid-cols-[repeat(3,minmax(15rem,1fr))] gap-4 px-1">
            {[0, 1, 2].map((column) => (
              <div key={column} className="min-w-0 space-y-3">
                <div className="flex h-10 items-center px-2">
                  <Skeleton className="h-3 w-20" />
                </div>
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="space-y-3 rounded-xl border border-border p-4 shadow-xs"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="size-3 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <div className="flex items-center justify-between pt-1">
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-3 w-6" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            {grouped && (
              <div className="flex h-10 items-center px-3">
                <Skeleton className="h-3 w-20" />
              </div>
            )}
            {Array.from({ length: count }, (_, index) => (
              <div
                key={index}
                className={
                  rows === 'compact'
                    ? 'flex min-h-6 items-center gap-2 py-1'
                    : `flex h-12 items-center gap-3 border-b border-border ${rows === 'integration' ? 'px-2' : 'px-3'}`
                }
              >
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-4 min-w-0 flex-1" />
                {rows === 'workspace' ? (
                  <Skeleton className="size-3 shrink-0 rounded-full" />
                ) : rows === 'integration' ? (
                  <Skeleton className="size-5 shrink-0 rounded-full" />
                ) : null}
                {rows !== 'compact' && (
                  <Skeleton
                    className={rows === 'workspace' ? 'h-3 w-8 shrink-0' : 'h-3 w-6 shrink-0'}
                  />
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

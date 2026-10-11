import type { CSSProperties } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD_CONTENT_INSET_CLASS } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LIST_STATE_GEOMETRY, type StateDensity } from '../state-geometry';

export interface LoadingStateProps {
  recipe?: 'list' | 'card-grid' | 'form';
  count?: number;
  label: string;
  density?: StateDensity;
  rowHeight?: number;
  inset?: boolean;
  className?: string;
}

export function LoadingState({
  recipe = 'list',
  count = 3,
  label,
  density = 'default',
  rowHeight,
  inset = false,
  className,
}: LoadingStateProps) {
  const geometry = LIST_STATE_GEOMETRY[density];
  const style = {
    '--state-list-row-height': `${rowHeight ?? geometry.rowHeight}px`,
    '--state-list-inline-inset': `${geometry.inlineInset}px`,
    '--state-list-row-gap': `${geometry.rowGap}px`,
  } as CSSProperties;

  return (
    <div
      data-slot="loading-state"
      data-recipe={recipe}
      data-density={density}
      data-inset={inset ? 'card' : undefined}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Loading announces status and retains the source block layout for every recipe.
      role="status"
      aria-label={label}
      style={recipe === 'list' ? style : undefined}
      className={cn(
        recipe === 'card-grid'
          ? 'grid grid-cols-2 gap-3'
          : recipe === 'form'
            ? 'space-y-3'
            : cn(
                'flex flex-col gap-(--state-list-row-gap)',
                inset ? CARD_CONTENT_INSET_CLASS : 'px-(--state-list-inline-inset)',
              ),
        inset && recipe !== 'list' && CARD_CONTENT_INSET_CLASS,
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) =>
        recipe === 'form' ? (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Skeleton
            key={index}
            className={
              recipe === 'card-grid' ? 'h-28 w-full' : 'h-(--state-list-row-height) w-full'
            }
          />
        ),
      )}
    </div>
  );
}

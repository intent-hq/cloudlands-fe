import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CARD_CONTENT_INSET_CLASS } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StateDensity } from '../state-geometry';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  density?: StateDensity;
  emphasis?: 'routine' | 'prominent';
  severity?: 'routine' | 'danger';
  inset?: boolean;
  contentClass?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  actions,
  actionLabel,
  onAction,
  children,
  density = 'default',
  emphasis = 'routine',
  severity = 'routine',
  inset = false,
  className,
  contentClass,
  ...props
}: EmptyStateProps) {
  return (
    <section
      data-slot="empty-state"
      data-density={density}
      data-emphasis={emphasis}
      data-severity={severity}
      data-inset={inset ? 'card' : undefined}
      className={cn(
        'flex items-center justify-center text-center',
        density === 'compact' ? 'min-h-28 py-6' : 'min-h-48 py-10',
        inset ? CARD_CONTENT_INSET_CLASS : density === 'compact' ? 'px-4' : 'px-6',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex w-full max-w-md flex-col',
          density === 'compact' ? 'gap-3' : 'gap-4',
          contentClass,
        )}
      >
        {icon != null && (
          <div
            data-slot="empty-state-icon"
            className={cn(
              'mx-auto flex w-fit',
              severity === 'danger' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {icon}
          </div>
        )}
        {(title != null || description != null) && (
          <div>
            {title != null && (
              <div
                data-slot="empty-state-title"
                className={cn(
                  emphasis === 'prominent'
                    ? 'type-title font-semibold text-foreground'
                    : density === 'compact'
                      ? 'type-caption font-normal'
                      : 'type-body font-normal',
                  emphasis === 'routine' && 'text-muted-foreground',
                )}
              >
                {title}
              </div>
            )}
            {description != null && (
              <div
                data-slot="empty-state-description"
                className={cn(
                  title != null && 'mt-1',
                  title != null || density === 'compact' ? 'type-caption' : 'type-body',
                  'text-muted-foreground',
                )}
              >
                {description}
              </div>
            )}
          </div>
        )}
        {(actions != null || (actionLabel && onAction)) && (
          <div data-slot="empty-state-actions" className="flex justify-center gap-2">
            {actions}
            {actionLabel && onAction && (
              <Button
                variant="ghost"
                size={density === 'compact' ? 'compact' : 'default'}
                onClick={onAction}
              >
                {actionLabel}
              </Button>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Screen({ className, children, ...props }: ComponentPropsWithRef<'section'>) {
  return (
    <section
      data-slot="screen"
      className={cn('flex min-h-0 min-w-0 flex-col bg-background text-foreground', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export interface ScreenHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  title: ReactNode;
  description?: ReactNode;
  counter?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}

export function ScreenHeader({
  title,
  description,
  counter,
  leading,
  actions,
  className,
  ...props
}: ScreenHeaderProps) {
  return (
    <header
      data-slot="screen-header"
      className={cn('flex min-w-0 shrink-0 items-start gap-3 px-5 pt-5', className)}
      {...props}
    >
      {leading != null && <div className="flex shrink-0 items-center">{leading}</div>}
      <div className="min-w-0 flex-1">
        {counter != null && (
          <div
            data-slot="screen-header-counter"
            className="type-caption mb-1 text-muted-foreground"
          >
            {counter}
          </div>
        )}
        <div data-slot="screen-header-title" className="min-w-0">
          {title}
        </div>
        {description != null && (
          <div data-slot="screen-header-description" className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions != null && (
        <div data-slot="screen-header-actions" className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      )}
    </header>
  );
}

export function ScreenBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="screen-body"
      className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto p-5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

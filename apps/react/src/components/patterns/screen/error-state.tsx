import type { HTMLAttributes, ReactNode } from 'react';
import type { StateDensity } from '../state-geometry';
import { EmptyState } from './empty-state';

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  message: ReactNode;
  retryLabel?: string;
  onRetry?: () => void;
  details?: ReactNode;
  detailsLabel?: string;
  icon?: ReactNode;
  density?: StateDensity;
  severity?: 'routine' | 'danger';
  inset?: boolean;
}

export function ErrorState({
  message,
  retryLabel,
  onRetry,
  details,
  detailsLabel,
  icon,
  density = 'default',
  severity = 'routine',
  inset = false,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <EmptyState
      description={message}
      icon={icon}
      actionLabel={retryLabel}
      onAction={onRetry}
      density={density}
      severity={severity}
      inset={inset}
      className={className}
      role="alert"
      data-state-kind="error"
      {...props}
    >
      {details != null && detailsLabel && (
        <details className="text-left type-caption text-muted-foreground">
          <summary className="cursor-pointer font-normal text-muted-foreground">
            {detailsLabel}
          </summary>
          <div className="mt-1.5">{details}</div>
        </details>
      )}
    </EmptyState>
  );
}

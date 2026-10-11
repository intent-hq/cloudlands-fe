// Source: src/lib/components/ui/ShimmerOverlay.svelte.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './shimmer-overlay.css';

export interface ShimmerOverlayProps {
  /** Authored animation duration in seconds, matching the source API. */
  duration?: number;
  className?: string;
  children?: ReactNode;
}

export function ShimmerOverlay({ duration = 8, className = '', children }: ShimmerOverlayProps) {
  const style = { animationDuration: `${duration}s` };
  return children !== undefined ? (
    <span className={cn('intent-shimmer-text', className)} style={style}>
      {children}
    </span>
  ) : (
    <div
      className={cn(
        'absolute inset-0 overflow-hidden pointer-events-none z-20 intent-shimmer-overlay',
        className,
      )}
      style={style}
    />
  );
}

export default ShimmerOverlay;

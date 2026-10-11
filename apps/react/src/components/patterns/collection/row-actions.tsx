// Source: patterns/collection/RowActions.svelte.
import * as React from 'react';
import {
  ActionBar,
  type ActionDefinition,
  type ActionHandler,
} from '@/components/patterns/action-menu';
import { cn } from '@/lib/utils';
export interface RowActionsProps {
  actions?: readonly ActionDefinition[];
  onAction?: ActionHandler;
  visibleCount?: number;
  controls?: React.ReactNode;
  overflowLabel: string;
  alwaysVisible?: boolean;
  overflowTriggerRef?: React.Ref<HTMLButtonElement | HTMLAnchorElement>;
  className?: string;
}
export function RowActions({
  actions = [],
  onAction,
  visibleCount = Number.POSITIVE_INFINITY,
  controls,
  overflowLabel,
  alwaysVisible = false,
  overflowTriggerRef,
  className,
}: RowActionsProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <div
      data-slot="row-actions"
      data-revealed={alwaysVisible || focused || undefined}
      className={cn(
        'flex items-center gap-1 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none',
        !alwaysVisible &&
          'opacity-0 group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100',
        className,
      )}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {controls}
      <ActionBar
        actions={actions}
        onAction={onAction}
        visibleCount={visibleCount}
        overflowLabel={overflowLabel}
        destructiveInline={false}
        overflowTriggerRef={overflowTriggerRef}
      />
    </div>
  );
}

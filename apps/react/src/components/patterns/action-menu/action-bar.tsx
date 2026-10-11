// Source: patterns/action-menu/ActionBar.svelte.
import * as React from 'react';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ActionMenu } from './action-menu';
import { splitActions } from './actions';
import type { ActionDefinition, ActionHandler } from './types';
export interface ActionBarProps {
  actions: readonly ActionDefinition[];
  onAction?: ActionHandler;
  visibleCount?: number;
  overflowLabel: string;
  destructiveInline?: boolean;
  className?: string;
  overflowTriggerRef?: React.Ref<HTMLButtonElement | HTMLAnchorElement>;
}
export function ActionBar({
  actions,
  onAction,
  visibleCount = Number.POSITIVE_INFINITY,
  overflowLabel,
  destructiveInline = true,
  className,
  overflowTriggerRef,
}: ActionBarProps) {
  const split = splitActions(actions, visibleCount);
  const visible = split.visible.filter(
    (action) => action.kind !== 'label' && !action.children?.length,
  );
  const overflow = [
    ...split.visible.filter((action) => action.kind === 'label' || action.children?.length),
    ...split.overflow,
  ];
  return (
    <div data-slot="action-bar" className={cn('flex items-center gap-1', className)}>
      {visible.map((action) => {
        const IconComponent = action.icon;
        return (
          <Button
            key={action.id}
            variant={action.destructive && destructiveInline ? 'destructive' : 'ghost-light'}
            size={IconComponent ? 'icon-xs' : 'xs'}
            iconOnly={Boolean(IconComponent)}
            aria-label={action.label}
            aria-pressed={action.checked}
            active={action.checked}
            disabled={action.disabled || action.disabledReason !== undefined}
            tooltip={
              action.disabledReason ?? (IconComponent || action.shortcut ? action.label : undefined)
            }
            tooltipShortcut={action.shortcut}
            onClick={(event) => onAction?.(action.id, event.nativeEvent)}
            data-action-id={action.id}
          >
            {IconComponent ? <IconComponent data-icon="inline-start" /> : action.label}
          </Button>
        );
      })}
      {overflow.length > 0 && (
        <ActionMenu
          actions={overflow}
          onAction={onAction}
          ariaLabel={overflowLabel}
          align="end"
          trigger={({ props }) => (
            <Button
              {...props}
              ref={overflowTriggerRef}
              variant="ghost-light"
              size="icon-xs"
              iconOnly
              aria-label={overflowLabel}
            >
              <DotsThreeVerticalIcon data-icon="inline-start" />
            </Button>
          )}
        />
      )}
    </div>
  );
}

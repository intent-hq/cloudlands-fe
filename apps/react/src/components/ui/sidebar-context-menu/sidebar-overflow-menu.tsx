// Source: src/lib/components/ui/sidebar-context-menu/SidebarOverflowMenu.svelte.
import { DotsThree, DotsThreeVertical } from '@phosphor-icons/react';
import { ActionMenu } from '@/components/patterns/action-menu';
import { Button } from '@/components/ui/button';
import { findSidebarItem, toSidebarActions } from './actions';
import type { SidebarMenuEntry } from './types';

export interface SidebarOverflowMenuProps {
  items: SidebarMenuEntry[];
  ariaLabel: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  orientation?: 'horizontal' | 'vertical';
  selection?: 'single';
  className?: string;
}
export function SidebarOverflowMenu({
  items,
  ariaLabel,
  open,
  defaultOpen,
  onOpenChange,
  orientation = 'vertical',
  selection,
  className,
}: SidebarOverflowMenuProps) {
  const Icon = orientation === 'horizontal' ? DotsThree : DotsThreeVertical;
  return (
    <ActionMenu
      actions={toSidebarActions(items, selection, ariaLabel)}
      ariaLabel={ariaLabel}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      align="end"
      onAction={(id) => findSidebarItem(items, id)?.onClick()}
      trigger={({ props }) => (
        <Button
          {...props}
          variant="plain"
          size="icon-compact"
          iconOnly
          type="button"
          className={className}
          aria-label={ariaLabel}
          onClick={(event) => {
            event.stopPropagation();
            props.onClick?.(event);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Icon aria-hidden="true" />
        </Button>
      )}
    />
  );
}
export default SidebarOverflowMenu;

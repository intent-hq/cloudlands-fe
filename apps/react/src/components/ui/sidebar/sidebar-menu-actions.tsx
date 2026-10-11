// Source: sidebar-menu-action.svelte, sidebar-menu-actions.svelte and sidebar-menu-badge.svelte.
import { useContext, useLayoutEffect, useMemo, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { useSize } from '@/components/ui/size-context';
import { cn } from '@/lib/utils';
import {
  SidebarMenuContext,
  SidebarMenuRowContext,
  SidebarMenuActionsContext,
} from './sidebar-menu-context';

export function SidebarMenuAction({
  className,
  showOnHover = false,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { showOnHover?: boolean }) {
  const row = useContext(SidebarMenuRowContext);
  const cluster = useContext(SidebarMenuActionsContext);
  const effective = cluster?.showOnHover ?? showOnHover;
  const registerAction = row?.registerAction;
  useLayoutEffect(() => registerAction?.(effective), [registerAction, effective]);
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      {...props}
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      data-show-on-hover={effective}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      className={cn(
        cluster
          ? 'relative flex size-6 shrink-0 items-center justify-center'
          : 'absolute right-1.5 z-10 flex size-6 items-center justify-center',
        !cluster && row?.hasBadge && 'right-8.5',
        !cluster && (row?.isSubRow ? 'top-0' : 'top-1'),
        'text-muted-foreground rounded-md hover:bg-hover hover:text-foreground transition-[color,background-color,opacity] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:-outline-offset-1 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast hover:[&_svg]:[stroke-width:2] after:absolute after:-inset-2 md:after:hidden group-data-[collapsible=icon]:hidden',
        !cluster &&
          effective &&
          'opacity-0 peer-focus-visible/menu-button:opacity-100 peer-hover/menu-button:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100 hover:opacity-100',
        'in-data-[force-actions=true]:opacity-100!',
        className,
      )}
    />
  );
}
export function SidebarMenuActions({
  className,
  showOnHover = false,
  children,
  ...props
}: ComponentProps<'div'> & { showOnHover?: boolean }) {
  const row = useContext(SidebarMenuRowContext);
  const value = useMemo(() => ({ showOnHover }), [showOnHover]);
  return (
    <SidebarMenuActionsContext value={value}>
      <div
        {...props}
        data-slot="sidebar-menu-actions"
        data-sidebar="menu-actions"
        data-show-on-hover={showOnHover}
        className={cn(
          'absolute right-1.5 z-10 flex items-center gap-1',
          row?.isSubRow ? 'top-0' : 'top-1',
          row?.hasBadge && 'right-8.5',
          showOnHover &&
            'opacity-0 transition-opacity duration-spring-fast ease-spring-fast group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none',
          'in-data-[force-actions=true]:opacity-100!',
          className,
        )}
      >
        {children}
      </div>
    </SidebarMenuActionsContext>
  );
}
export function SidebarMenuBadge({ className, style, ...props }: ComponentProps<'div'>) {
  const row = useContext(SidebarMenuRowContext);
  const menu = useContext(SidebarMenuContext);
  const size = useSize();
  const lit = row && menu?.activeIndexes.get(row.level) === row.index;
  const setHasBadge = row?.setHasBadge;
  useLayoutEffect(() => {
    setHasBadge?.(true);
    return () => setHasBadge?.(false);
  }, [setHasBadge]);
  return (
    <div
      {...props}
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      style={{ fontVariationSettings: lit ? "'wght' 500" : "'wght' 400", ...style }}
      className={cn(
        'type-caption pointer-events-none absolute right-2 z-10 flex h-5 min-w-5 select-none items-center justify-center px-1 tabular-nums transition-[color,font-variation-settings] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
        size === 'compact' ? 'top-1' : 'top-1.5',
        lit ? 'text-foreground' : 'text-muted-foreground',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
    />
  );
}

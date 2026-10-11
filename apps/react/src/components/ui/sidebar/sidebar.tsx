// Source: src/lib/components/ui/sidebar/sidebar.svelte.
import { useLayoutEffect, type ComponentProps, type CSSProperties } from 'react';
import * as Sheet from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { useSidebar } from './context';
import { SidebarRail } from './sidebar-rail';

export type SidebarProps = ComponentProps<'div'> & {
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  collapsible?: 'offcanvas' | 'icon' | 'none';
  rail?: boolean;
  bordered?: boolean;
};
export function Sidebar({
  ref,
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  rail = true,
  bordered = true,
  className,
  children,
  onPointerEnter,
  onPointerLeave,
  ...props
}: SidebarProps) {
  const sidebar = useSidebar();
  const effectiveCollapsible = collapsible === 'icon' ? 'offcanvas' : collapsible;
  const setSide = sidebar.setSide;
  useLayoutEffect(() => setSide(side), [setSide, side]);
  if (collapsible === 'none')
    return (
      <div
        {...props}
        ref={ref}
        className={cn(
          'bg-sidebar text-sidebar-foreground w-(--sidebar-width) flex h-full flex-col',
          className,
        )}
      >
        {children}
      </div>
    );
  if (sidebar.isMobile)
    return (
      <Sheet.Root open={sidebar.openMobile} onOpenChange={sidebar.setOpenMobile}>
        <Sheet.Content
          {...props}
          ref={ref}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          side={side}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            sidebar.restoreMobileFocus();
          }}
          className={cn(
            'bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden [&>[data-slot=sheet-body]]:p-0',
            className,
          )}
          style={{ '--sidebar-width': sidebar.widthMobile, ...props.style } as CSSProperties}
        >
          <Sheet.Header className="sr-only">
            <Sheet.Title>{m.ui_sidebar_title_label()}</Sheet.Title>
            <Sheet.Description>{m.ui_sidebar_mobile_description()}</Sheet.Description>
          </Sheet.Header>
          <div className="flex h-full w-full flex-col">{children}</div>
        </Sheet.Content>
      </Sheet.Root>
    );
  return (
    <div
      ref={ref}
      className="text-sidebar-foreground group peer hidden md:block"
      data-state={sidebar.state}
      data-collapsible={sidebar.state === 'collapsed' ? effectiveCollapsible : ''}
      data-peeking={sidebar.peekOpen}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="w-(--sidebar-width) relative bg-transparent transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none group-data-[collapsible=offcanvas]:w-0 group-data-[side=right]:rotate-180"
      />
      <div
        {...props}
        data-slot="sidebar-container"
        className={cn(
          'w-(--sidebar-width) fixed inset-y-0 z-10 hidden h-svh transition-[left,right,width] duration-spring-slow ease-spring-slow motion-reduce:transition-none md:flex',
          side === 'left'
            ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
            : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
          'group-data-[peeking=true]:left-auto group-data-[peeking=true]:right-auto',
          side === 'left'
            ? 'group-data-[peeking=true]:left-0'
            : 'group-data-[peeking=true]:right-0',
          variant === 'floating' || variant === 'inset'
            ? 'p-2'
            : bordered &&
                'group-data-[side=left]:border-r group-data-[side=right]:border-l border-border',
          sidebar.peekOpen && 'p-2',
          className,
        )}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          sidebar.requestPeek('hover');
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (sidebar.peek === 'hover') sidebar.dismissPeek();
        }}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          inert={!sidebar.open && !sidebar.peekOpen}
          aria-hidden={(!sidebar.open && !sidebar.peekOpen) || undefined}
          className={cn(
            'bg-sidebar flex h-full w-full flex-col group-data-[variant=floating]:rounded-md group-data-[variant=floating]:shadow-(--elevation-raised) group-data-[variant=inset]:overflow-hidden group-data-[variant=inset]:rounded-md',
            bordered &&
              'group-data-[variant=floating]:border group-data-[variant=floating]:border-border',
            sidebar.peekOpen && 'rounded-md border border-border shadow-(--elevation-overlay)',
          )}
        >
          {children}
        </div>
        {rail && effectiveCollapsible === 'offcanvas' && <SidebarRail />}
      </div>
    </div>
  );
}

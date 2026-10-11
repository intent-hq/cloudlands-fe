// Source: sidebar-menu-button.svelte and sidebar-menu-sub-button.svelte.
import {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Button } from '@/components/ui/button';
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  type TooltipContentProps,
} from '@/components/ui/tooltip';
import { useSize } from '@/components/ui/size-context';
import { useProximityHover } from '@/lib/interaction';
import { cn } from '@/lib/utils';
import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';
import { m } from '$shared/paraglide/messages.js';
import { useSidebar } from './context';
import {
  SidebarMenuContext,
  SidebarMenuRowContext,
  SidebarMenuVisibleContext,
} from './sidebar-menu-context';

export const sidebarMenuButtonVariants = cva(
  'peer/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md pl-2 pr-(--row-gutter) text-left transition-[padding] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus-ring focus-visible:shadow-none group-hover/menu-item:pr-(--row-gutter-hover) group-focus-within/menu-item:pr-(--row-gutter-hover) motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: '',
        outline:
          'border border-border bg-background shadow-(--elevation-raised) data-[proximity-active=true]:border-sidebar-accent',
      },
      size: {
        // Keep the source row content-sized instead of inheriting Button's fixed height.
        default: [OPTION_LIST_ROW_CLASS, 'h-auto'],
        sm: 'type-caption h-(--control-height-compact)',
        lg: 'type-body group-data-[collapsible=icon]:p-0! h-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export type SidebarMenuButtonVariant = VariantProps<typeof sidebarMenuButtonVariants>['variant'];
export type SidebarMenuButtonSize = VariantProps<typeof sidebarMenuButtonVariants>['size'];
function rowGutter(count: number, badge: boolean) {
  if (!count && !badge) return 8;
  return (
    (badge ? 8 : 6) +
    (badge ? 24 : 0) +
    (count ? count * 24 + (count - 1) * 4 : 0) +
    (badge && count ? 4 : 0) +
    4
  );
}
function useMenuRow(active: boolean, disabled: boolean) {
  const row = useContext(SidebarMenuRowContext);
  const menu = useContext(SidebarMenuContext);
  const visible = useContext(SidebarMenuVisibleContext);
  const root = useRef<HTMLElement | null>(null);
  useProximityHover(menu?.hover ?? null);
  const index = row?.index ?? -1;
  const level = row?.level ?? 'root';
  const registerElement = menu?.registerElement;
  const setActive = menu?.setActive;
  useLayoutEffect(() => {
    if (!registerElement || !root.current || disabled || !visible) return;
    registerElement(index, root.current, level);
    return () => registerElement(index, null);
  }, [registerElement, index, level, disabled, visible]);
  useLayoutEffect(() => {
    if (!setActive) return;
    setActive(index, level, active && visible && !disabled);
    return () => setActive(index, level, false);
  }, [setActive, index, level, active, visible, disabled]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!active || !visible || !node) return;
    const scroller = node.closest<HTMLElement>('[data-sidebar="content"]');
    if (!scroller || node.closest('[inert]')) return;
    const bounds = node.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    if (bounds.top < viewport.top) scroller.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom) scroller.scrollTop += bounds.bottom - viewport.bottom;
  }, [active, visible]);
  useLayoutEffect(() => {
    const node = root.current;
    return () => {
      if (!node || node.ownerDocument.activeElement !== node) return;
      const rows = Array.from(
        node
          .closest('[data-sidebar="menu"]')
          ?.querySelectorAll<HTMLElement>(
            '[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]',
          ) ?? [],
      );
      const at = rows.indexOf(node);
      const ordered = [...rows.slice(at + 1), ...rows.slice(0, at).reverse()];
      queueMicrotask(() => {
        if (!node.isConnected && node.ownerDocument.activeElement === node.ownerDocument.body)
          ordered
            .find(
              (item) =>
                item.isConnected &&
                !item.matches(':disabled,[aria-disabled="true"]') &&
                !item.closest('[inert],[hidden]'),
            )
            ?.focus();
      });
    };
  }, []);
  const setElement = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);
  const gutterHover = rowGutter(row?.actionCount ?? 0, row?.hasBadge ?? false);
  return {
    setElement,
    row,
    menu,
    proximityActive: menu ? menu.hover?.activeIndex === index : false,
    tabIndex: menu
      ? disabled || !visible
        ? -1
        : menu.preferredIndex === index
          ? 0
          : -1
      : undefined,
    style: {
      '--row-gutter': `${row?.actionsShowOnHover ? rowGutter(0, row.hasBadge) : gutterHover}px`,
      '--row-gutter-hover': `${gutterHover}px`,
    } as CSSProperties,
  };
}
export type SidebarMenuButtonProps = ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  status?: 'active' | 'unread' | 'idle';
  dot?: 'filled' | 'ring';
  icon?: ReactNode;
  label?: string;
  variant?: SidebarMenuButtonVariant;
  size?: SidebarMenuButtonSize;
  tooltipContent?: ReactNode;
  tooltipContentProps?: TooltipContentProps;
};
export function SidebarMenuButton({
  ref,
  className,
  children,
  asChild = false,
  variant = 'default',
  size = 'default',
  isActive = false,
  status,
  dot,
  icon,
  label,
  tooltipContent,
  tooltipContentProps,
  onFocus,
  style,
  disabled = false,
  ...props
}: SidebarMenuButtonProps) {
  const sidebar = useSidebar();
  const density = useSize();
  const active = isActive || status === 'active';
  const row = useMenuRow(
    active,
    disabled || props['aria-disabled'] === true || props['aria-disabled'] === 'true',
  );
  const lit = active || row.proximityActive;
  const resolvedDot = dot ?? (status ? (status === 'idle' ? 'ring' : 'filled') : undefined);
  const resolvedSize = size === 'default' && density === 'compact' ? 'sm' : size;
  const content = (
    <>
      {icon ? (
        <span
          className={cn(
            'sidebar-menu-icon text-muted-foreground flex size-4 shrink-0 items-center justify-center transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none [&>svg]:size-4 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
            lit && 'text-foreground',
          )}
        >
          {icon}
        </span>
      ) : (
        resolvedDot && (
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span
              className={cn(
                'size-2 rounded-full transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                resolvedDot === 'ring' ? 'border border-current' : 'bg-current',
                lit ? 'text-foreground' : 'text-ghost',
              )}
            />
          </span>
        )
      )}
      {label ? (
        <>
          <span className="inline-grid min-w-0 flex-1 text-left font-normal">
            <span className="invisible col-start-1 row-start-1 truncate" aria-hidden="true">
              {label}
            </span>
            <span
              className={cn(
                'text-muted-foreground col-start-1 row-start-1 truncate transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                lit && 'text-foreground',
              )}
            >
              {label}
            </span>
          </span>
          {children}
        </>
      ) : (
        <span
          className={cn(
            'text-muted-foreground flex min-w-0 flex-1 items-center gap-2 truncate font-normal transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            lit && 'text-foreground',
          )}
        >
          {children}
        </span>
      )}
      {status === 'unread' && (
        <span className="sr-only">, {m.hud_workspaceState_unread_label()}</span>
      )}
    </>
  );
  const button = (
    <Button
      {...props}
      ref={(node) => {
        row.setElement(node);
        if (typeof ref === 'function') return ref(node as HTMLButtonElement | null);
        if (ref) ref.current = node as HTMLButtonElement | null;
      }}
      asChild={asChild}
      variant="plain"
      wrapContent={false}
      disabled={disabled}
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={resolvedSize}
      data-active={active}
      data-status={status}
      data-proximity-active={row.proximityActive}
      data-sidebar-index={row.row?.index}
      aria-current={active ? 'page' : undefined}
      tabIndex={props.tabIndex ?? row.tabIndex}
      className={cn(
        sidebarMenuButtonVariants({ variant, size: resolvedSize }),
        !row.menu && 'data-[proximity-active=true]:bg-hover data-[active=true]:bg-active',
        'data-[active=true]:text-foreground data-[proximity-active=true]:text-foreground',
        className,
      )}
      style={{ ...row.style, ...style }}
      onFocus={(event) => {
        row.menu?.hover?.setActiveIndex(row.row?.index ?? null);
        row.menu?.setFocus(row.row?.index ?? null);
        onFocus?.(event);
      }}
    >
      {asChild ? children : content}
    </Button>
  );
  return tooltipContent ? (
    <TooltipRoot>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={sidebar.state !== 'collapsed' || sidebar.isMobile}
        {...tooltipContentProps}
      >
        {tooltipContent}
      </TooltipContent>
    </TooltipRoot>
  ) : (
    button
  );
}
export type SidebarMenuSubButtonProps = ComponentProps<'a'> & {
  asChild?: boolean;
  size?: 'sm' | 'md';
  isActive?: boolean;
  icon?: ReactNode;
  label?: string;
};
export function SidebarMenuSubButton({
  ref,
  children,
  asChild = false,
  className,
  size = 'md',
  isActive = false,
  icon,
  label,
  onFocus,
  style,
  ...props
}: SidebarMenuSubButtonProps) {
  const row = useMenuRow(
    isActive,
    props['aria-disabled'] === true || props['aria-disabled'] === 'true',
  );
  const density = useSize();
  const lit = isActive || row.proximityActive;
  const Element = asChild ? Slot.Root : 'a';
  return (
    <Element
      {...props}
      ref={(node) => {
        row.setElement(node);
        if (typeof ref === 'function') return ref(node as HTMLAnchorElement | null);
        if (ref) ref.current = node as HTMLAnchorElement | null;
      }}
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      data-proximity-active={row.proximityActive}
      data-sidebar-index={row.row?.index}
      aria-current={isActive ? 'page' : undefined}
      tabIndex={props.tabIndex ?? row.tabIndex}
      style={{ ...row.style, ...style }}
      className={cn(
        'relative z-10 flex w-full min-w-0 cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md pl-2 pr-(--row-gutter) text-left outline-none transition-[padding] duration-spring-fast ease-spring-fast group-hover/menu-sub-item:pr-(--row-gutter-hover) group-focus-within/menu-sub-item:pr-(--row-gutter-hover) motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        size === 'sm' || density === 'compact' ? 'h-6 text-xs' : 'type-caption h-7',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      onFocus={(event) => {
        row.menu?.hover?.setActiveIndex(row.row?.index ?? null);
        row.menu?.setFocus(row.row?.index ?? null);
        onFocus?.(event as React.FocusEvent<HTMLAnchorElement>);
      }}
    >
      {asChild ? (
        children
      ) : (
        <>
          {icon && (
            <span
              className={cn(
                'sidebar-menu-sub-icon text-muted-foreground flex size-4 shrink-0 items-center justify-center transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none [&>svg]:size-4 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
                lit && 'text-foreground',
              )}
            >
              {icon}
            </span>
          )}
          {label ? (
            <>
              <span className="inline-grid min-w-0 flex-1 text-left">
                <span
                  className="invisible col-start-1 row-start-1 truncate"
                  style={{ fontVariationSettings: "'wght' 500" }}
                  aria-hidden="true"
                >
                  {label}
                </span>
                <span
                  className={cn(
                    'text-muted-foreground col-start-1 row-start-1 truncate transition-[color,font-variation-settings] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                    lit && 'text-foreground',
                  )}
                  style={{ fontVariationSettings: isActive ? "'wght' 500" : "'wght' 400" }}
                >
                  {label}
                </span>
              </span>
              {children}
            </>
          ) : (
            <span
              className={cn(
                'text-muted-foreground flex min-w-0 flex-1 items-center gap-2 truncate transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                lit && 'text-foreground',
                isActive && 'font-medium',
              )}
            >
              {children}
            </span>
          )}
        </>
      )}
    </Element>
  );
}

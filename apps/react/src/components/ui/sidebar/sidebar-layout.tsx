// Source: sidebar-{header,footer,content,inset,input,separator,trigger,callout,menu-skeleton}.svelte.
import { useLayoutEffect, useRef, type ComponentProps, type CSSProperties } from 'react';
import { List } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { scrollFade } from '$lib/actions/scroll-fade';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { useSidebar } from './context';

type StackProps = ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' };
export function SidebarHeader({ className, orientation = 'vertical', ...props }: StackProps) {
  return (
    <div
      {...props}
      data-slot="sidebar-header"
      data-sidebar="header"
      data-orientation={orientation}
      className={cn(
        'flex shrink-0 gap-2 p-2',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
        className,
      )}
    />
  );
}
export function SidebarFooter({ className, orientation = 'vertical', ...props }: StackProps) {
  return (
    <div
      {...props}
      data-slot="sidebar-footer"
      data-sidebar="footer"
      data-orientation={orientation}
      className={cn(
        'mt-auto flex shrink-0 gap-2 p-2',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
        className,
      )}
    />
  );
}
export function SidebarContent({ ref, className, ...props }: ComponentProps<'div'>) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    const fade = scrollFade(root.current);
    return () => fade?.destroy?.();
  }, []);
  return (
    <div
      {...props}
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'border-border flex min-h-0 flex-1 flex-col gap-2 overflow-auto border-y',
        className,
      )}
    />
  );
}
export function SidebarInset({
  as: Element = 'main',
  className,
  ref,
  ...props
}: ComponentProps<'main'> & { as?: 'main' | 'div' }) {
  return (
    <Element
      {...props}
      ref={(node) => {
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="sidebar-inset"
      className={cn(
        'bg-background relative flex w-full flex-1 flex-col md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 md:peer-data-[variant=inset]:rounded-md md:peer-data-[variant=inset]:shadow-(--elevation-raised)',
        className,
      )}
    />
  );
}
export function SidebarInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn('bg-background h-(--control-height-medium) w-full shadow-none', className)}
    />
  );
}
export function SidebarSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      {...props}
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('bg-border', className)}
    />
  );
}
export function SidebarTrigger({
  className,
  onClick,
  onPointerEnter,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const sidebar = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={m.ui_sidebar_toggle_label()}
      type="button"
      {...props}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      className={cn('size-6 [&_svg]:size-4', className)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) sidebar.requestPeek('hover');
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) sidebar.toggle();
      }}
    >
      {children ?? (
        <>
          <List aria-hidden="true" />
          <span className="sr-only">{m.ui_sidebar_toggle_label()}</span>
        </>
      )}
    </Button>
  );
}
export function SidebarCallout({
  className,
  variant = 'banner',
  ...props
}: ComponentProps<'div'> & { variant?: 'banner' | 'inline' }) {
  return (
    <div
      {...props}
      data-slot="sidebar-callout"
      data-sidebar="callout"
      data-variant={variant}
      className={cn(
        'text-foreground',
        variant === 'banner'
          ? 'bg-surface-2 shadow-surface-2 flex flex-col gap-2 rounded-xl p-3'
          : 'bg-hover flex items-center gap-2 rounded-md px-2 py-1.5',
        className,
      )}
    />
  );
}
export function SidebarMenuSkeleton({
  className,
  showIcon = false,
  widthIndex = 0,
  children,
  ...props
}: ComponentProps<'div'> & { showIcon?: boolean; widthIndex?: number }) {
  const widths = ['62%', '74%', '55%', '82%', '68%'];
  return (
    <div
      {...props}
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn('flex h-(--control-height-medium) items-center gap-2 px-2', className)}
    >
      {showIcon && (
        <Skeleton className="size-4 shrink-0 rounded-md" data-sidebar="menu-skeleton-icon" />
      )}
      <Skeleton
        className="max-w-(--skeleton-width) h-4 flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          { '--skeleton-width': widths[Math.abs(widthIndex) % widths.length] } as CSSProperties
        }
      />
      {children}
    </div>
  );
}

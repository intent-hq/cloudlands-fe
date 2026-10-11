// Source: deprecated ui/dropdown-menu.svelte composition, retained for incremental callers.
import * as React from 'react';
import * as Menu from './menu';
import { m } from '$shared/paraglide/messages.js';
let closeActive: (() => void) | null = null;
export interface DropdownMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  portal?: boolean;
  collisionPadding?: number;
  alignIconColumn?: boolean;
  trigger: (state: {
    toggle: () => void;
    open: boolean;
    props: React.ComponentProps<typeof Menu.Trigger>;
  }) => React.ReactElement;
  content: (state: { close: () => void }) => React.ReactNode;
  contentClass?: string;
  subContentClass?: string;
  contentMaxHeight?: string;
  className?: string;
}
export function DropdownMenu({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  onOpenChangeComplete,
  align = 'start',
  side = 'bottom',
  portal = true,
  collisionPadding = 8,
  alignIconColumn = false,
  trigger,
  content,
  contentClass,
  subContentClass,
  contentMaxHeight,
  className,
}: DropdownMenuProps) {
  const root = React.useRef<HTMLDivElement>(null);
  const [local, setLocal] = React.useState(defaultOpen);
  const open = controlled ?? local;
  const latest = React.useRef({ open, onOpenChange, onOpenChangeComplete });
  React.useLayoutEffect(() => {
    latest.current = { open, onOpenChange, onOpenChangeComplete };
  });
  const change = React.useCallback((next: boolean) => {
    setLocal(next);
    latest.current.onOpenChange?.(next);
  }, []);
  const close = React.useCallback(() => change(false), [change]);
  React.useEffect(() => {
    if (!open) return;
    const previous = closeActive;
    closeActive = close;
    if (previous && previous !== close) previous();
    return () => {
      if (closeActive === close) closeActive = null;
    };
  }, [open, close]);
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (root.current?.contains(event.target) || event.target.closest('[role="menu"]')) return;
      close();
      if (!event.target.closest('[data-dropdown-menu-trigger]'))
        queueMicrotask(() => {
          root.current?.querySelector<HTMLElement>('[data-dropdown-menu-trigger]')?.focus();
        });
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);
  // The wrapper accepts both legacy onClick={toggle} and spread trigger props.
  // Disable Radix's pointer-down toggle so the click has one state transition.
  const toggle = () => change(!open);
  return (
    <div ref={root} className={className}>
      <Menu.Root
        open={open}
        onOpenChange={change}
        onOpenChangeComplete={onOpenChangeComplete}
        modal={false}
      >
        <Menu.Trigger asChild onPointerDown={(event) => event.preventDefault()} onClick={toggle}>
          {/* oxlint-disable-next-line react/refs -- Render prop receives an event callback; no ref is read during rendering. */}
          {trigger({ toggle, open, props: {} })}
        </Menu.Trigger>
        <Menu.Content
          align={align}
          side={side}
          portal={portal}
          collisionPadding={collisionPadding}
          alignIconColumn={alignIconColumn}
          subContentClass={subContentClass}
          className={contentClass}
          maxHeight={contentMaxHeight}
          aria-label={m.ui_dropdownMenu_ariaLabel()}
        >
          {/* oxlint-disable-next-line react/refs -- Render prop receives an event callback; no ref is read during rendering. */}
          {content({ close })}
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}

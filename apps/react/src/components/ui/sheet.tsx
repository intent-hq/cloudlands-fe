// Source: src/lib/components/ui/sheet/*.svelte; shadcn Radix dialog composition.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useFocusScopeRef } from '@/lib/interaction/focus-scope';
import { m } from '$shared/paraglide/messages.js';
import {
  springIn,
  crispOut,
  usePresence,
  usePresenceTransition,
  type TransitionFactory,
} from '@/lib/motion';
import { Button } from './button';
import { clampSurface, SurfaceProvider, surfaceClasses, useSurface } from './surface-context';
import './sheet.css';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export const sheetVariants = cva(
  'sheet-editorial-content text-popover-foreground fixed z-[var(--layer-modal)] flex flex-col overflow-y-auto overscroll-contain outline-none motion-reduce:animate-none motion-reduce:transition-none',
  {
    variants: {
      side: {
        top: 'inset-x-2 top-0 rounded-b-(--radius-large) sm:inset-x-4',
        bottom: 'inset-x-2 bottom-0 rounded-t-(--radius-large) sm:inset-x-4',
        left: 'inset-y-2 left-0 rounded-r-(--radius-large)',
        right: 'inset-y-2 right-0 rounded-l-(--radius-large)',
      },
    },
    defaultVariants: { side: 'right' },
  },
);
const SheetOpen = createContext(false);
const backdropTransition: TransitionFactory =
  (node) =>
  ({ direction } = {}) =>
    direction === 'out'
      ? crispOut(node, { tier: 'moderate', x: 0, y: 0, scale: 1, opacity: 0 })
      : springIn(node, { tier: 'moderate', x: 0, y: 0, scale: 1, opacity: 0 });
const offset: Record<Side, { x: string | number; y: string | number }> = {
  top: { x: 0, y: '-100%' },
  right: { x: '100%', y: 0 },
  bottom: { x: 0, y: '100%' },
  left: { x: '-100%', y: 0 },
};
export function Sheet({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof SheetPrimitive.Root>) {
  const [internal, setInternal] = useState(defaultOpen);
  const current = open ?? internal;
  return (
    <SheetOpen value={current}>
      <SheetPrimitive.Root
        {...props}
        open={current}
        onOpenChange={(next) => {
          setInternal(next);
          onOpenChange?.(next);
        }}
      >
        {children}
      </SheetPrimitive.Root>
    </SheetOpen>
  );
}
export function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}
export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}
export function SheetPortal(props: ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal {...props} />;
}
function AnimatedOverlay({
  ref,
  className,
  present,
  onExit,
  ...props
}: ComponentProps<typeof SheetPrimitive.Overlay> & { present: boolean; onExit: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, backdropTransition);
  return (
    <SheetPrimitive.Overlay
      {...props}
      forceMount
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-[var(--layer-modal)] bg-black/40 dark:bg-black/80 motion-reduce:animate-none motion-reduce:transition-none',
        className,
      )}
    />
  );
}
export function SheetOverlay({
  forceMount,
  ...props
}: ComponentProps<typeof SheetPrimitive.Overlay>) {
  const open = useContext(SheetOpen);
  const items = useMemo(() => (open || forceMount ? ['overlay'] : []), [open, forceMount]);
  const presence = usePresence(items, (key) => key);
  return presence.entries.map((entry) => (
    <AnimatedOverlay
      key={entry.key}
      {...props}
      present={entry.present}
      onExit={() => presence.remove(entry.key)}
    />
  ));
}
export type SheetContentProps = ComponentProps<typeof SheetPrimitive.Content> & {
  portalProps?: ComponentProps<typeof SheetPrimitive.Portal>;
  side?: Side;
  showCloseButton?: boolean;
  closeDisabled?: boolean;
  closeLabel?: string;
};
export function SheetContent({ forceMount, ...props }: SheetContentProps) {
  const open = useContext(SheetOpen);
  const items = useMemo(() => (open || forceMount ? ['content'] : []), [open, forceMount]);
  const presence = usePresence(items, (key) => key);
  return presence.entries.map((entry) => (
    <MountedSheet
      key={entry.key}
      {...props}
      present={entry.present}
      onExit={() => presence.remove(entry.key)}
    />
  ));
}
function MountedSheet({
  ref,
  className,
  side = 'right',
  portalProps,
  showCloseButton = true,
  closeDisabled = false,
  closeLabel,
  onInteractOutside,
  children,
  present,
  onExit,
  ...props
}: SheetContentProps & { present: boolean; onExit: () => void }) {
  const surface = clampSurface(useSurface() + 2);
  const root = useRef<HTMLDivElement>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const assignRef = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      setElement(node);
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  const scopeRef = useFocusScopeRef({ enabled: useContext(SheetOpen) }, assignRef);
  const transition = useMemo<TransitionFactory>(
    () =>
      (node) =>
      ({ direction } = {}) =>
        direction === 'out'
          ? crispOut(node, { tier: 'slow', scale: 1, opacity: 1, ...offset[side] })
          : springIn(node, { tier: 'slow', scale: 1, opacity: 1, ...offset[side] }),
    [side],
  );
  usePresenceTransition(root, present, onExit, transition, Boolean(element));
  return (
    <SheetPortal {...portalProps} forceMount>
      <SurfaceProvider level={surface}>
        <AnimatedOverlay present={present} onExit={() => {}} />
        <SheetPrimitive.Content
          {...props}
          forceMount
          ref={scopeRef}
          data-slot="sheet-content"
          data-side={side}
          data-surface-level={surface}
          className={cn(sheetVariants({ side }), surfaceClasses(surface), className)}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-image-lightbox-root]')
            )
              event.preventDefault();
            onInteractOutside?.(event);
          }}
        >
          <div data-slot="sheet-body" className="flex min-w-0 flex-1 flex-col px-6 py-4">
            {children}
          </div>
          {showCloseButton && (
            <SheetPrimitive.Close asChild disabled={closeDisabled}>
              <Button
                aria-label={closeLabel ?? m.ui_sheet_close_label()}
                disabled={closeDisabled}
                variant="ghost"
                size="icon-sm"
                iconOnly
                className="absolute right-3 top-3 text-muted-foreground"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </Button>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SurfaceProvider>
    </SheetPortal>
  );
}
export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex min-w-0 flex-col gap-1.5 px-6 pb-4 pt-6 pr-12', className)}
      {...props}
    />
  );
}
export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex flex-col gap-2 px-6 pb-6 pt-4 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('type-title font-bold leading-tight text-foreground', className)}
      {...props}
    />
  );
}
export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('type-caption break-words text-muted-foreground', className)}
      {...props}
    />
  );
}
export {
  Sheet as Root,
  SheetTrigger as Trigger,
  SheetClose as Close,
  SheetPortal as Portal,
  SheetOverlay as Overlay,
  SheetContent as Content,
  SheetHeader as Header,
  SheetFooter as Footer,
  SheetTitle as Title,
  SheetDescription as Description,
};

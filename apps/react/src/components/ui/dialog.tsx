// Based on shadcn/ui dialog; sizes, primary-action focus and containment match dialog-content.svelte.
import * as React from 'react';
import { XIcon } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { m } from '$shared/paraglide/messages.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSize } from '@/components/ui/size-context';
import {
  clampSurface,
  SurfaceProvider,
  surfaceClasses,
  useSurface,
} from '@/components/ui/surface-context';
import './dialog.css';

const StaticDialog = React.createContext(false);
const DialogPortalTarget = React.createContext<HTMLElement | null>(null);
export function useDialogPortalTarget() {
  return React.useContext(DialogPortalTarget);
}
export function Dialog({
  staticPosition = false,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { staticPosition?: boolean }) {
  return (
    <StaticDialog value={staticPosition}>
      <DialogPrimitive.Root {...props} modal={staticPosition ? false : props.modal}>
        {children}
      </DialogPrimitive.Root>
    </StaticDialog>
  );
}
export function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}
export function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal {...props} />;
}
export function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
export function DialogOverlay({
  className,
  contained = false,
  staticPosition = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & {
  contained?: boolean;
  staticPosition?: boolean;
}) {
  const classes = cn(
    contained || staticPosition ? 'absolute' : 'fixed',
    'react-dialog-overlay inset-0 z-(--layer-modal) motion-reduce:animate-none motion-reduce:transition-none',
    className,
  );
  if (staticPosition)
    return (
      <div data-slot="dialog-overlay" data-static-position className={classes} aria-hidden="true" />
    );
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={classes} {...props} />;
}
export type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalProps?: React.ComponentProps<typeof DialogPrimitive.Portal>;
  container?: HTMLElement | null;
  size?: 'sm' | 'default' | 'lg' | 'wide' | 'editor';
  showCloseButton?: boolean;
  closeDisabled?: boolean;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
};
export function DialogContent({
  ref,
  className,
  portalProps,
  container,
  size = 'default',
  showCloseButton = true,
  closeDisabled = false,
  closeLabel,
  role = 'dialog',
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
  ...props
}: DialogContentProps) {
  const isStatic = React.useContext(StaticDialog);
  const surface = clampSurface(useSurface() + 2);
  const density = useSize();
  const root = React.useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = React.useState<HTMLDivElement | null>(null);
  const assignRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      setPortalTarget(node);
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  const handleOpenAutoFocus = (event: Event) => {
    if (isStatic) {
      event.preventDefault();
      return;
    }
    onOpenAutoFocus?.(event);
    const node = root.current;
    if (event.defaultPrevented || !node) return;
    const belongs = (element: HTMLElement) =>
      element.closest('[data-slot="dialog-content"]') === node;
    const canFocus = (element: HTMLElement) =>
      !element.matches(':disabled, [aria-disabled="true"], [inert]') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
    const actions = Array.from(
      node.querySelectorAll<HTMLElement>(
        '[data-dialog-primary-action], [data-slot="dialog-footer"] button, [data-slot="dialog-footer"] a[href]',
      ),
    ).filter(belongs);
    const primary =
      actions.find((action) => action.hasAttribute('data-dialog-primary-action')) ?? actions.at(-1);
    const field = Array.from(
      node.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, [contenteditable="true"]',
      ),
    ).find((element) => belongs(element) && canFocus(element));
    const target = primary && canFocus(primary) ? primary : (field ?? node);
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  const content = (
    <SurfaceProvider level={surface}>
      <DialogOverlay contained={Boolean(container)} staticPosition={isStatic} />
      <DialogPrimitive.Content
        {...props}
        ref={assignRef}
        role={role}
        data-slot="dialog-content"
        data-overlay-surface
        data-size={size}
        data-static-position={isStatic || undefined}
        data-surface-level={surface}
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest('[data-image-lightbox-root]'))
            event.preventDefault();
          onInteractOutside?.(event);
        }}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          if (isStatic) event.preventDefault();
          else onCloseAutoFocus?.(event);
        }}
        className={cn(
          isStatic ? 'relative mx-auto' : container ? 'absolute' : 'fixed',
          !isStatic && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'dialog-editorial-content overlay-surface z-(--layer-modal) grid w-full overflow-y-auto overscroll-contain p-6 text-popover-foreground outline-none motion-reduce:animate-none motion-reduce:transition-none',
          size === 'sm' && (density === 'compact' ? 'max-w-90' : 'max-w-100'),
          size === 'default' && 'max-w-110',
          size === 'lg' && (density === 'compact' ? 'max-w-120' : 'max-w-135'),
          size === 'wide' && 'max-w-2xl',
          size === 'editor' && 'max-w-6xl',
          surfaceClasses(surface),
          className,
        )}
      >
        <DialogPortalTarget value={portalTarget}>{children}</DialogPortalTarget>
        {showCloseButton && (
          <DialogPrimitive.Close asChild disabled={closeDisabled}>
            <Button
              aria-label={closeLabel ?? m.ui_dialog_close_ariaLabel()}
              disabled={closeDisabled}
              variant="ghost"
              size="icon-sm"
              iconOnly
              className="dialog-close-button absolute right-6 -translate-y-1/2 text-muted-foreground"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SurfaceProvider>
  );
  return isStatic ? (
    content
  ) : (
    <DialogPortal {...portalProps} container={container ?? portalProps?.container}>
      {content}
    </DialogPortal>
  );
}
export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('mb-4 flex min-w-0 flex-col gap-1.5 pr-8', className)}
      {...props}
    />
  );
}
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'dialog-actions mt-6 flex min-w-0 flex-wrap items-center justify-end gap-2',
        className,
      )}
      {...props}
    />
  );
}
export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('type-title font-bold text-foreground [anchor-name:--dialog-title]', className)}
      {...props}
    />
  );
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('type-caption break-words text-muted-foreground', className)}
      {...props}
    />
  );
}

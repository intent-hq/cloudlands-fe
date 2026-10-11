// Based on shadcn/ui tooltip; public wrappers preserve the source Tooltip API.
import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { ShortcutChip } from '@/components/ui/kbd';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import { RichTrigger } from '@/components/ui/tooltip-rich';
import './tooltip.css';

export { TooltipRich, type TooltipRichProps } from '@/components/ui/tooltip-rich';
// LinkTooltip and its state helpers await their framework-state migration.

const StaticTooltip = React.createContext(false);
const HasTooltipProvider = React.createContext(false);
const variantStyles = {
  default: 'bg-foreground text-background',
  secondary: 'bg-secondary text-secondary-foreground border border-border',
  destructive: 'bg-danger text-danger-background border border-danger',
  outline: 'bg-transparent text-foreground ring-1 ring-inset ring-border',
};
const sizeStyles = {
  sm: 'type-caption px-2 py-1',
  default: 'type-caption px-2 py-1',
  lg: 'type-title px-4 py-2',
};

export function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasTooltipProvider value={true}>
      <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
    </HasTooltipProvider>
  );
}
export type TooltipRootProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
  staticPosition?: boolean;
};
export function TooltipRoot({ staticPosition = false, ...props }: TooltipRootProps) {
  const hasProvider = React.useContext(HasTooltipProvider);
  const root = (
    <StaticTooltip value={staticPosition}>
      <TooltipPrimitive.Root {...props} />
    </StaticTooltip>
  );
  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>;
}
export type TooltipPortalProps = React.ComponentProps<typeof TooltipPrimitive.Portal> & {
  to?: Element | string;
  disabled?: boolean;
};
export function TooltipPortal({
  to,
  container,
  disabled = false,
  children,
  ...props
}: TooltipPortalProps) {
  const [target, setTarget] = React.useState<{ selector: string; element: Element | null }>();
  React.useLayoutEffect(() => {
    if (typeof to === 'string' && !disabled) {
      const element = document.querySelector(to);
      if (!element && import.meta.env.DEV) {
        // i18n-ignore (developer configuration error)
        throw new Error(`Target element "${to}" not found.`);
      }
      // oxlint-disable-next-line react/set-state-in-effect -- Resolve the external DOM host after sibling elements mount, including hydration.
      setTarget({ selector: to, element });
    }
  }, [to, disabled]);
  if (disabled) return children;
  // Resolve selectors after the trigger and any sibling portal host have mounted.
  if (typeof to === 'string' && (target?.selector !== to || !target.element)) return null;
  const resolved = typeof to === 'string' ? target?.element : to;
  return (
    <TooltipPrimitive.Portal container={resolved ?? container} {...props}>
      {children}
    </TooltipPrimitive.Portal>
  );
}

export function TooltipTrigger({
  asChild,
  className,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      asChild={asChild}
      className={cn(
        !asChild &&
          'type-caption inline-flex h-(--control-height-medium) items-center justify-center gap-1.5 rounded-(--radius-medium)',
        className,
      )}
      {...props}
    />
  );
}
export type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content> & {
  portalTarget?: Element | string | null;
  staticPosition?: boolean;
  showArrow?: boolean;
  arrowClasses?: string;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  size?: 'sm' | 'default' | 'lg';
};
export function TooltipContent({
  className,
  sideOffset = 0,
  side = 'top',
  children,
  portalTarget,
  staticPosition,
  showArrow = true,
  arrowClasses,
  variant = 'default',
  size = 'default',
  ...props
}: TooltipContentProps) {
  const surface = clampSurface(useSurface() + 2);
  const rootStatic = React.useContext(StaticTooltip);
  const isStatic = staticPosition ?? rootStatic;
  const content = (
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      data-static-position={isStatic || undefined}
      data-surface-level={surface}
      data-overlay-surface
      side={side}
      sideOffset={sideOffset}
      className={cn(
        'tooltip-motion overlay-surface z-(--layer-tooltip) w-fit max-w-xs whitespace-pre-wrap text-balance [&_kbd]:text-background/70',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
      {!isStatic && showArrow && (
        <TooltipPrimitive.Arrow className={cn('fill-foreground', arrowClasses)} />
      )}
    </TooltipPrimitive.Content>
  );
  return (
    <SurfaceProvider level={surface}>
      {isStatic ? (
        <div data-tooltip-static-position>{content}</div>
      ) : (
        <TooltipPortal to={portalTarget ?? undefined}>{content}</TooltipPortal>
      )}
    </SurfaceProvider>
  );
}

export interface TooltipProps {
  content?: React.ReactNode;
  side?: TooltipContentProps['side'];
  align?: TooltipContentProps['align'];
  sideOffset?: number;
  alignOffset?: number;
  delayDuration?: number;
  disableHoverableContent?: boolean;
  disableCloseOnTriggerClick?: boolean;
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  portalTarget?: Element | string;
  className?: string;
  contentClass?: string;
  arrowClass?: string;
  showArrow?: boolean;
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
}

/** Source Tooltip.svelte: children/trigger/content snippets become React nodes. */
export function Tooltip({
  content = '',
  side = 'top',
  align = 'center',
  sideOffset = 4,
  alignOffset = 0,
  delayDuration = 0,
  disableHoverableContent = true,
  disableCloseOnTriggerClick = false,
  disabled = false,
  open,
  defaultOpen = false,
  onOpenChange,
  portalTarget,
  className,
  contentClass,
  arrowClass,
  showArrow = false,
  variant = 'default',
  size = 'default',
  children,
  trigger,
  onClick,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const contentId = React.useId();
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (disabled && next) return;
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [disabled, open, onOpenChange],
  );
  // Notify controlled callers once for each open state suppressed by disabled.
  const closedWhileDisabled = React.useRef(false);
  React.useEffect(() => {
    if (disabled && isOpen) {
      if (!closedWhileDisabled.current) {
        closedWhileDisabled.current = true;
        handleOpenChange(false);
      }
    } else {
      closedWhileDisabled.current = false;
    }
  }, [disabled, isOpen, handleOpenChange]);

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipPrimitive.Root
        open={!disabled && isOpen}
        onOpenChange={handleOpenChange}
        delayDuration={delayDuration}
        disableHoverableContent={disableHoverableContent}
      >
        <TooltipPrimitive.Trigger asChild>
          <RichTrigger
            ref={triggerRef}
            disabled={disabled}
            tabIndex={disabled ? undefined : 0}
            className={cn('inline-flex', className)}
            data-tooltip-trigger=""
            data-delay-duration={delayDuration}
            data-disabled={disabled ? '' : undefined}
            disableCloseOnTriggerClick={disableCloseOnTriggerClick}
            onTriggerClick={onClick}
          >
            {trigger ?? children}
          </RichTrigger>
        </TooltipPrimitive.Trigger>
        {Boolean(content) && !disabled && (
          <TooltipPortal to={portalTarget}>
            <TooltipPrimitive.Content
              id={contentId}
              role="tooltip"
              side={side}
              align={align}
              sideOffset={sideOffset}
              alignOffset={alignOffset}
              className={cn(
                'tooltip-motion overlay-surface z-(--layer-tooltip) w-fit max-w-xs whitespace-pre-wrap text-balance',
                variantStyles[variant],
                sizeStyles[size],
                contentClass,
              )}
              data-tooltip-content=""
              data-overlay-surface=""
              onPointerDownOutside={(event) => {
                if (
                  disableCloseOnTriggerClick &&
                  triggerRef.current?.contains(event.target as Node)
                ) {
                  event.preventDefault();
                }
              }}
            >
              {content}
              {showArrow && (
                <div
                  className={cn(
                    'absolute bg-border',
                    side === 'top' && 'w-px h-1.5 -bottom-1.5',
                    side === 'bottom' && 'w-px h-1.5 -top-1.5',
                    (side === 'top' || side === 'bottom') &&
                      align === 'center' &&
                      'left-1/2 -translate-x-1/2',
                    (side === 'top' || side === 'bottom') && align === 'start' && 'left-1.5',
                    (side === 'top' || side === 'bottom') && align === 'end' && 'right-1.5',
                    side === 'left' && 'h-px w-1.5 -right-1.5',
                    side === 'right' && 'h-px w-1.5 -left-1.5',
                    (side === 'left' || side === 'right') &&
                      align === 'center' &&
                      'top-1/2 -translate-y-1/2',
                    (side === 'left' || side === 'right') && align === 'start' && 'top-1.5',
                    (side === 'left' || side === 'right') && align === 'end' && 'bottom-1.5',
                    arrowClass,
                  )}
                />
              )}
            </TooltipPrimitive.Content>
          </TooltipPortal>
        )}
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
}

export interface TooltipShortcutProps {
  label: string;
  shortcut?: string | string[];
  secondary?: { label: string; shortcut: string | string[] };
  side?: TooltipContentProps['side'];
  align?: TooltipContentProps['align'];
  sideOffset?: number;
  delayDuration?: number;
  disabled?: boolean;
  portalTarget?: Element | string;
  className?: string;
  contentClass?: string;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
}
function shortcutKeys(shortcut: string | string[]) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  // i18n-ignore (standard platform key names)
  const replacements: Record<string, string> = {
    mod: mac ? '⌘' : 'Ctrl',
    cmd: mac ? '⌘' : 'Ctrl',
    command: mac ? '⌘' : 'Ctrl',
    ctrl: mac ? '⌃' : 'Ctrl',
    control: mac ? '⌃' : 'Ctrl',
    alt: mac ? '⌥' : 'Alt',
    option: mac ? '⌥' : 'Alt',
    shift: mac ? '⇧' : 'Shift',
    enter: '↵',
    return: '↵',
    delete: '⌦',
    backspace: '⌫',
    escape: 'Esc',
    esc: 'Esc',
    tab: '⇥',
    space: '␣',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    pageup: 'PgUp',
    pagedown: 'PgDn',
    home: 'Home',
    end: 'End',
  };
  return (Array.isArray(shortcut) ? shortcut : shortcut.split('+')).map(
    (key) => replacements[key.trim().toLowerCase()] ?? key.trim().toUpperCase(),
  );
}
export function TooltipShortcut({
  label,
  shortcut,
  secondary,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  delayDuration = 500,
  disabled = false,
  portalTarget,
  className,
  contentClass,
  children,
  trigger,
}: TooltipShortcutProps) {
  const line = (text: string, keys?: string | string[]) => (
    <>
      <span className="type-caption">{text}</span>
      {keys && (
        <div className="flex items-center gap-1 text-muted-foreground">
          {shortcutKeys(keys).map((key, index) => (
            <ShortcutChip key={`${index}-${key}`}>{key}</ShortcutChip>
          ))}
        </div>
      )}
    </>
  );
  return (
    <Tooltip
      side={side}
      align={align}
      sideOffset={sideOffset}
      delayDuration={delayDuration}
      disabled={disabled}
      portalTarget={portalTarget}
      className={className}
      contentClass={cn(
        secondary ? 'flex flex-col items-stretch gap-1.5' : 'flex items-center gap-3',
        contentClass,
      )}
      trigger={children ?? trigger}
      content={
        secondary ? (
          <>
            <div className="flex items-center justify-between gap-3">{line(label, shortcut)}</div>
            <div className="flex items-center justify-between gap-3">
              {line(secondary.label, secondary.shortcut)}
            </div>
          </>
        ) : (
          line(label, shortcut)
        )
      }
    />
  );
}

export {
  TooltipRoot as Root,
  TooltipTrigger as Trigger,
  TooltipContent as Content,
  TooltipProvider as Provider,
  TooltipPortal as Portal,
};

// Based on shadcn/ui tooltip; wrappers preserve the existing shortcut API.
import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { ShortcutChip } from '@/components/ui/kbd';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import './tooltip.css';

export function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}
export function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root {...props} />
    </TooltipProvider>
  );
}
export function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}
export type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content> & {
  portalTarget?: HTMLElement | null;
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
  showArrow = true,
  arrowClasses,
  variant = 'default',
  size = 'default',
  ...props
}: TooltipContentProps) {
  const surface = clampSurface(useSurface() + 2);
  return (
    <SurfaceProvider level={surface}>
      <TooltipPrimitive.Portal container={portalTarget}>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          data-surface-level={surface}
          data-overlay-surface
          side={side}
          sideOffset={sideOffset}
          className={cn(
            'tooltip-motion overlay-surface z-(--layer-tooltip) w-fit max-w-xs whitespace-pre-wrap text-balance [&_kbd]:text-background/70',
            {
              default: 'bg-foreground text-background',
              secondary: 'bg-secondary text-secondary-foreground border border-border',
              destructive: 'bg-danger text-danger-background border border-danger',
              outline: 'bg-transparent text-foreground ring-1 ring-inset ring-border',
            }[variant],
            size === 'lg' ? 'type-title px-4 py-2' : 'type-caption px-2 py-1',
            className,
          )}
          {...props}
        >
          {children}
          {showArrow && <TooltipPrimitive.Arrow className={cn('fill-foreground', arrowClasses)} />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </SurfaceProvider>
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
  portalTarget?: HTMLElement | null;
  className?: string;
  contentClass?: string;
  children: React.ReactElement;
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
}: TooltipShortcutProps) {
  const line = (text: string, keys?: string | string[]) => (
    <>
      <span className="type-caption">{text}</span>
      {keys && (
        <span className="flex items-center gap-1 text-muted-foreground">
          {shortcutKeys(keys).map((key, index) => (
            <ShortcutChip key={`${index}-${key}`}>{key}</ShortcutChip>
          ))}
        </span>
      )}
    </>
  );
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipPrimitive.Root
        delayDuration={delayDuration}
        disableHoverableContent
        open={disabled ? false : undefined}
      >
        <TooltipTrigger asChild className={className}>
          {children}
        </TooltipTrigger>
        {!disabled && (
          <TooltipContent
            side={side}
            align={align}
            sideOffset={sideOffset}
            portalTarget={portalTarget}
            showArrow={false}
            className={cn(
              secondary ? 'flex flex-col items-stretch gap-1.5' : 'flex items-center gap-3',
              contentClass,
            )}
          >
            {secondary ? (
              <>
                <span className="flex items-center justify-between gap-3">
                  {line(label, shortcut)}
                </span>
                <span className="flex items-center justify-between gap-3">
                  {line(secondary.label, secondary.shortcut)}
                </span>
              </>
            ) : (
              line(label, shortcut)
            )}
          </TooltipContent>
        )}
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
}

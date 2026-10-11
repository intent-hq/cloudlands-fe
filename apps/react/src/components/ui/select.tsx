// Based on shadcn/ui select; existing trigger variants and trailing indicators retained.
import * as React from 'react';
import { CheckIcon, CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { Select as SelectPrimitive } from 'radix-ui';
import { m } from '$shared/paraglide/messages.js';
import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';
import { cn } from '@/lib/utils';
import { useFocusScopeRef } from '@/lib/interaction/focus-scope';
import { Button } from '@/components/ui/button';
import { ListHighlight, menuItem } from '@/components/ui/menu';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import { menuOverlayClass } from './overlay-recipes';
import './overlays.css';

type SelectItemData = { value: string; label: string; disabled?: boolean };
const SelectContext = React.createContext({
  invalid: false,
  staticPosition: false,
  items: [] as SelectItemData[],
  value: '',
  open: false,
  loop: true,
});
export type SelectProps = React.ComponentProps<typeof SelectPrimitive.Root> & {
  invalid?: boolean;
  items?: SelectItemData[];
  staticPosition?: boolean;
  loop?: boolean;
};
export function Select({
  invalid = false,
  staticPosition = false,
  items = [],
  value,
  defaultValue = '',
  open,
  defaultOpen = false,
  loop = true,
  onValueChange,
  onOpenChange,
  children,
  ...props
}: SelectProps) {
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  return (
    <SelectContext
      value={{
        invalid,
        staticPosition,
        items,
        value: value ?? localValue,
        open: open ?? localOpen,
        loop,
      }}
    >
      <div
        data-slot="select-root"
        className="relative min-w-0 w-full"
        data-static-position={staticPosition || undefined}
      >
        <SelectPrimitive.Root
          {...props}
          value={value ?? localValue}
          open={open ?? localOpen}
          onValueChange={(next) => {
            setLocalValue(next);
            onValueChange?.(next);
          }}
          onOpenChange={(next) => {
            setLocalOpen(next);
            onOpenChange?.(next);
          }}
        >
          {children}
        </SelectPrimitive.Root>
      </div>
    </SelectContext>
  );
}
export function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}
export function SelectValue({
  placeholder,
  children,
  className,
  style,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const select = React.useContext(SelectContext);
  return (
    // Radix Value discards className/style; its inner span still owns the ref and item text portal.
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-left',
        select.value ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      style={style}
    >
      <SelectPrimitive.Value
        data-slot="select-value"
        placeholder={placeholder ?? m.ui_select_value_placeholder()}
        {...props}
      >
        {children ??
          (select.items.length
            ? (select.items.find((item) => item.value === select.value)?.label ?? select.value)
            : undefined)}
      </SelectPrimitive.Value>
    </span>
  );
}
export function SelectTrigger({
  className,
  variant = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  variant?: 'default' | 'underline' | 'ghost' | 'secondary';
}) {
  const select = React.useContext(SelectContext);
  const classes = cn(
    'group type-caption text-foreground flex h-(--control-height-medium) w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-(--radius-medium) transition-[border-color,background-color,box-shadow] duration-spring-fast aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent motion-reduce:transition-none',
    {
      default:
        'border border-border bg-transparent shadow-none hover:border-input hover:bg-hover px-3',
      underline:
        'border-0 bg-transparent underline underline-offset-3 decoration-muted-foreground/30 px-3',
      ghost: 'border-0 bg-transparent shadow-none hover:border-transparent hover:bg-hover px-3',
      secondary:
        'border border-border bg-secondary text-secondary-foreground shadow-(--elevation-raised) hover:border-input hover:bg-hover px-3',
    }[variant],
    className,
  );
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      aria-invalid={select.invalid || undefined}
      className={classes}
      {...props}
      asChild
    >
      <Button
        variant={
          variant === 'default' ? 'outline' : variant === 'secondary' ? 'secondary' : 'ghost'
        }
        active={select.open}
        className={classes}
      >
        {children}
        {variant === 'default' && (
          <SelectPrimitive.Icon asChild>
            <CaretDownIcon
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground transition-transform duration-spring-fast group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </SelectPrimitive.Icon>
        )}
      </Button>
    </SelectPrimitive.Trigger>
  );
}
export function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'start',
  portal = false,
  portalProps,
  dropUp = false,
  wrapperClass,
  wrapperId,
  sideOffset = 4,
  collisionPadding = 8,
  ref,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  portal?: boolean;
  portalProps?: React.ComponentProps<typeof SelectPrimitive.Portal>;
  dropUp?: boolean;
  wrapperClass?: string;
  wrapperId?: string;
}) {
  const select = React.useContext(SelectContext);
  const surface = clampSurface(useSurface() + 2);
  const attachContent = React.useCallback(
    (node: HTMLDivElement | null) => {
      const releaseRef = typeof ref === 'function' ? ref(node) : undefined;
      if (ref && typeof ref !== 'function') ref.current = node;
      const wrapper = node?.parentElement;
      const previousId = wrapper?.getAttribute('id');
      if (wrapper && wrapperId && select.open) wrapper.id = wrapperId;
      return () => {
        if (wrapper && wrapperId && select.open && wrapper.id === wrapperId) {
          if (previousId == null) wrapper.removeAttribute('id');
          else wrapper.id = previousId;
        }
        if (typeof releaseRef === 'function') releaseRef();
        else if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref, wrapperId, select.open],
  );
  const scopeRef = useFocusScopeRef({ enabled: select.open }, attachContent);
  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;

    // Bits advances its active option synchronously. Radix defers focus, so a following
    // Enter can select the previous option. Preserve source looping without the delay.
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    ).filter((item) => item.closest('[data-slot="select-content"]') === event.currentTarget);
    let candidates = items.filter((item) => !item.hasAttribute('data-disabled'));
    if (event.key === 'ArrowUp' || event.key === 'End') candidates.reverse();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const index = candidates.findIndex((item) => item === event.target);
      candidates = select.loop
        ? [...candidates.slice(index + 1), ...candidates.slice(0, index + 1)]
        : candidates.slice(index + 1);
    }
    event.preventDefault();
    const viewport = event.currentTarget.querySelector<HTMLElement>('[data-radix-select-viewport]');
    const previouslyFocused = event.currentTarget.ownerDocument.activeElement;
    for (const candidate of candidates) {
      if (candidate === previouslyFocused) break;
      candidate.scrollIntoView({ block: 'nearest' });
      if (viewport && candidate === items[0]) viewport.scrollTop = 0;
      if (viewport && candidate === items.at(-1)) viewport.scrollTop = viewport.scrollHeight;
      candidate.focus();
      if (candidate.ownerDocument.activeElement !== previouslyFocused) break;
    }
  };
  const content = (
    <SelectPrimitive.Content
      ref={scopeRef}
      data-slot="select-content"
      data-surface-level={surface}
      data-static-position={select.staticPosition || undefined}
      className={cn(
        menuOverlayClass,
        'w-(--radix-select-trigger-width) max-h-60 rounded-(--radius-medium)',
        select.staticPosition && 'w-full',
        className,
      )}
      position={position}
      align={align}
      side={dropUp ? 'top' : 'bottom'}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      {...props}
      onKeyDown={handleKeyDown}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn('relative isolate min-h-0 flex-1 overflow-y-auto p-1', wrapperClass)}
      >
        <ListHighlight />
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  );
  return (
    <SurfaceProvider level={surface}>
      {(portal || dropUp) && !select.staticPosition ? (
        <SelectPrimitive.Portal {...portalProps}>{content}</SelectPrimitive.Portal>
      ) : (
        content
      )}
    </SurfaceProvider>
  );
}
export function SelectItem({
  className,
  children,
  label,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { label?: string }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-menu-item
      className={cn(menuItem(), className)}
      textValue={label}
      {...props}
    >
      <div className="min-w-0 flex-1 truncate">
        <SelectPrimitive.ItemText>{children ?? label}</SelectPrimitive.ItemText>
      </div>
      <span
        data-slot="select-item-check"
        className={cn(OPTION_LIST_END_SLOT_CLASS, 'text-primary-ink')}
        aria-hidden="true"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon aria-hidden="true" className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}
export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('type-caption px-2 py-1.5 text-muted-foreground', className)}
      {...props}
    />
  );
}
export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
export function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <CaretUpIcon aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}
export function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <CaretDownIcon aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

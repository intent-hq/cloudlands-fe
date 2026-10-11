// Sources: src/lib/components/ui/menu/*.svelte. Radix composition verified against
// the official shadcn dropdown-menu registry; canonical styling and API are retained.
import * as React from 'react';
import { DropdownMenu as Primitive } from 'radix-ui';
import {
  CheckIcon,
  MinusIcon,
  CaretRightIcon,
  type Icon,
  type IconWeight,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ShortcutChip } from '@/components/ui/kbd';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import { OPTION_LIST_ROW_CLASS, OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';
import {
  getPageTargetIndex,
  handleMenuPageKey,
  setMenuTabStop,
  syncMenuTabStopFromFocus,
} from '$lib/components/ui/menu/menu-roving-focus';
import { resolveSubmenuSide } from '$lib/components/ui/menu/submenu-placement';
import { menuItem, menuOverlay, menuSubmenuAlignOffset } from './menu-recipes';
import { ListHighlight } from './list-highlight';
export {
  menuItem,
  menuOverlay,
  menuOverlayTransition,
  menuSubmenuAlignOffset,
} from './menu-recipes';
export { getPageTargetIndex, ListHighlight };

const RootContext = React.createContext({
  staticPosition: false,
  open: false,
  dir: 'ltr' as 'ltr' | 'rtl',
  onContentNode: (_node: HTMLDivElement | null) => {},
});
const SubContext = React.createContext<{
  trigger: HTMLDivElement | null;
  setTrigger: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
} | null>(null);
const LayoutContext = React.createContext<{
  align: boolean;
  reserve: boolean;
  register: () => () => void;
} | null>(null);
const SubClassContext = React.createContext<string | undefined>(undefined);
function Layout({
  alignIconColumn,
  children,
}: {
  alignIconColumn?: boolean;
  children: React.ReactNode;
}) {
  const parent = React.useContext(LayoutContext);
  const [icons, setIcons] = React.useState(0);
  const register = React.useCallback(() => {
    setIcons((value) => value + 1);
    return () => setIcons((value) => value - 1);
  }, []);
  const align = alignIconColumn ?? parent?.align ?? false;
  const value = React.useMemo(
    () => ({ align, reserve: align && icons > 0, register }),
    [align, icons, register],
  );
  return <LayoutContext value={value}>{children}</LayoutContext>;
}
function Leading({ children }: { children?: React.ReactNode }) {
  const layout = React.useContext(LayoutContext);
  const hasIcon = Boolean(children);
  const register = layout?.register;
  React.useLayoutEffect(() => (hasIcon ? register?.() : undefined), [hasIcon, register]);
  return hasIcon || layout?.reserve ? (
    <span
      data-slot="menu-item-leading"
      className="flex h-lh w-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {children}
    </span>
  ) : null;
}
export function Root({
  staticPosition = false,
  // Bits ContentStatic leaves sibling content exposed and disables scroll locking.
  // Radix's modal branch hides siblings, so inline menus use its non-modal branch.
  modal = !staticPosition,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  onOpenChangeComplete,
  dir = 'ltr',
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Root> & {
  staticPosition?: boolean;
  onOpenChangeComplete?: (open: boolean) => void;
}) {
  const [local, setLocal] = React.useState(defaultOpen);
  const open = controlled ?? local;
  const contentNode = React.useRef<HTMLDivElement | null>(null);
  const previousOpen = React.useRef(open);
  const onContentNode = React.useCallback((node: HTMLDivElement | null) => {
    contentNode.current = node;
  }, []);
  React.useEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const animations = contentNode.current?.getAnimations() ?? [];
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (!cancelled) onOpenChangeComplete?.(open);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [open, onOpenChangeComplete]);
  return (
    <RootContext value={{ staticPosition, open, dir, onContentNode }}>
      <Primitive.Root
        {...props}
        modal={modal}
        dir={dir}
        open={open}
        onOpenChange={(value) => {
          setLocal(value);
          onOpenChange?.(value);
        }}
      >
        {children}
      </Primitive.Root>
    </RootContext>
  );
}
export function Trigger(props: React.ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="menu-trigger" data-dropdown-menu-trigger {...props} />;
}
export const Portal = Primitive.Portal;
export const Group = Primitive.Group;
export const GroupHeading = Primitive.Label;
export const RadioGroup = Primitive.RadioGroup;
export function Sub({ children, ...props }: React.ComponentProps<typeof Primitive.Sub>) {
  const [trigger, setTrigger] = React.useState<HTMLDivElement | null>(null);
  return (
    <SubContext value={{ trigger, setTrigger }}>
      <Primitive.Sub {...props}>{children}</Primitive.Sub>
    </SubContext>
  );
}
function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
}

type ContentExtras = {
  portal?: boolean;
  portalProps?: React.ComponentProps<typeof Portal>;
  maxHeight?: string;
  staticPosition?: boolean;
  alignIconColumn?: boolean;
  subContentClass?: string;
  preventScroll?: boolean;
  /** Passed through to Radix's underlying menu focus scope. */
  onOpenAutoFocus?: (event: Event) => void;
};
export type ContentProps = React.ComponentProps<typeof Primitive.Content> & ContentExtras;
export function Content({
  ref,
  portal = true,
  portalProps,
  staticPosition,
  alignIconColumn = false,
  subContentClass,
  maxHeight = 'var(--radix-dropdown-menu-content-available-height, calc(100dvh - 1rem))',
  sideOffset = 4,
  collisionPadding = 8,
  className,
  style,
  onKeyDown,
  onFocus,
  children,
  preventScroll: _preventScroll,
  ...props
}: ContentProps) {
  const root = React.useContext(RootContext);
  const isStatic = staticPosition ?? root.staticPosition;
  const surface = clampSurface(useSurface() + 2);
  const onContentNode = root.onContentNode;
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      onContentNode(node);
      const cleanup = assignRef(ref, node);
      if (node)
        queueMicrotask(() => {
          if (node.isConnected) setMenuTabStop(node);
        });
      return cleanup;
    },
    [ref, onContentNode],
  );
  const content = (
    <Primitive.Content
      {...props}
      ref={contentRef}
      data-slot="menu-content"
      data-surface-level={surface}
      data-static-position={isStatic || undefined}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        menuOverlay(),
        'relative isolate min-w-40 overflow-y-auto overscroll-contain p-1',
        className,
      )}
      style={{ maxHeight, ...style }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          event.target instanceof Element &&
          event.target.closest('[role="menu"]') === event.currentTarget
        )
          if (handleMenuPageKey(event.currentTarget, event.nativeEvent)) event.preventDefault();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        syncMenuTabStopFromFocus(event.currentTarget, event.target);
      }}
    >
      <ListHighlight />
      {children}
    </Primitive.Content>
  );
  return (
    <SurfaceProvider level={surface}>
      <Layout alignIconColumn={alignIconColumn}>
        <SubClassContext value={subContentClass}>
          {isStatic ? (
            <div data-static-position>{content}</div>
          ) : portal ? (
            <Portal {...portalProps}>{content}</Portal>
          ) : (
            content
          )}
        </SubClassContext>
      </Layout>
    </SurfaceProvider>
  );
}
export type SubContentProps = Omit<React.ComponentProps<typeof Primitive.SubContent>, 'align'> &
  ContentExtras & {
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
  };
export function SubContent({
  ref,
  side,
  align = 'start',
  alignOffset,
  sideOffset = 4,
  avoidCollisions = true,
  collisionPadding = 8,
  portal = true,
  portalProps,
  staticPosition,
  alignIconColumn,
  subContentClass,
  maxHeight = 'var(--radix-dropdown-menu-content-available-height, calc(100dvh - 1rem))',
  preventScroll: _preventScroll,
  className,
  style,
  children,
  onKeyDown,
  onFocus,
  ...props
}: SubContentProps) {
  const root = React.useContext(RootContext);
  const trigger = React.useContext(SubContext);
  const inheritedClass = React.useContext(SubClassContext);
  const isStatic = staticPosition ?? root.staticPosition;
  const surface = clampSurface(useSurface() + 2);
  const contentNode = React.useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const preferredSide = side ?? (root.dir === 'rtl' ? 'left' : 'right');
  const contentRef = React.useCallback(
    (value: HTMLDivElement | null) => {
      contentNode.current = value;
      setMounted(Boolean(value));
      const cleanup = assignRef(ref, value);
      if (value)
        queueMicrotask(() => {
          if (value.isConnected) setMenuTabStop(value);
        });
      return cleanup;
    },
    [ref],
  );
  React.useLayoutEffect(() => {
    const node = contentNode.current;
    if (!node || !trigger?.trigger || isStatic) return;
    const wrapper = node.parentElement;
    if (!wrapper) return;
    const padding =
      typeof collisionPadding === 'number'
        ? {
            top: collisionPadding,
            right: collisionPadding,
            bottom: collisionPadding,
            left: collisionPadding,
          }
        : { top: 0, right: 0, bottom: 0, left: 0, ...collisionPadding };
    const update = () => {
      const anchor = trigger.trigger;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const resolved = avoidCollisions
        ? resolveSubmenuSide(
            preferredSide,
            rect,
            node.offsetWidth,
            window.innerWidth,
            sideOffset,
            padding,
          )
        : preferredSide;
      // Radix SubContent fixes its side from text direction. Keep its focus/tree
      // semantics, and position the popper wrapper only for the source's extra sides.
      if (resolved === (root.dir === 'rtl' ? 'left' : 'right')) {
        delete wrapper.dataset.menuPosition;
        wrapper.style.removeProperty('--menu-placement-x');
        wrapper.style.removeProperty('--menu-placement-y');
        node.style.removeProperty('transform-origin');
        return;
      }
      const height = node.offsetHeight;
      const width = node.offsetWidth;
      let x =
        resolved === 'left'
          ? rect.left - width - sideOffset
          : resolved === 'right'
            ? rect.right + sideOffset
            : align === 'end'
              ? rect.right - width
              : align === 'center'
                ? rect.left + (rect.width - width) / 2
                : rect.left;
      let y =
        resolved === 'top'
          ? rect.top - height - sideOffset
          : resolved === 'bottom'
            ? rect.bottom + sideOffset
            : rect.top + (alignOffset ?? menuSubmenuAlignOffset);
      if (avoidCollisions) {
        x = Math.max(padding.left, Math.min(x, window.innerWidth - padding.right - width));
        y = Math.max(padding.top, Math.min(y, window.innerHeight - padding.bottom - height));
      }
      wrapper.dataset.menuPosition = 'custom';
      wrapper.style.setProperty('--menu-placement-x', `${x}px`);
      wrapper.style.setProperty('--menu-placement-y', `${y}px`);
      node.style.transformOrigin =
        resolved === 'top'
          ? 'bottom'
          : resolved === 'bottom'
            ? 'top'
            : resolved === 'left'
              ? 'right'
              : 'left';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(trigger.trigger);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [
    mounted,
    trigger,
    preferredSide,
    root.dir,
    isStatic,
    sideOffset,
    collisionPadding,
    avoidCollisions,
    align,
    alignOffset,
  ]);
  const content = (
    <Primitive.SubContent
      {...props}
      ref={contentRef}
      align={align === 'center' ? 'start' : align}
      alignOffset={alignOffset ?? menuSubmenuAlignOffset}
      sideOffset={sideOffset}
      avoidCollisions={avoidCollisions}
      collisionPadding={collisionPadding}
      data-slot="menu-sub-content"
      data-static-position={isStatic || undefined}
      data-surface-level={surface}
      className={cn(
        menuOverlay(),
        'relative isolate min-w-40 overflow-y-auto overscroll-contain p-1',
        inheritedClass,
        className,
      )}
      style={{ maxHeight, ...style }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && handleMenuPageKey(event.currentTarget, event.nativeEvent))
          event.preventDefault();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        syncMenuTabStopFromFocus(event.currentTarget, event.target);
      }}
    >
      <ListHighlight />
      {children}
    </Primitive.SubContent>
  );
  return (
    <SurfaceProvider level={surface}>
      <Layout alignIconColumn={alignIconColumn}>
        <SubClassContext value={subContentClass ?? inheritedClass}>
          {isStatic ? (
            <div data-static-position>{content}</div>
          ) : portal ? (
            <Portal {...portalProps}>{content}</Portal>
          ) : (
            content
          )}
        </SubClassContext>
      </Layout>
    </SurfaceProvider>
  );
}
export function Indicator({
  state,
  className,
  ...props
}: React.ComponentProps<'span'> & { state: 'checked' | 'mixed' | 'submenu' | 'empty' }) {
  const Glyph = state === 'mixed' ? MinusIcon : state === 'submenu' ? CaretRightIcon : CheckIcon;
  return (
    <span
      {...props}
      data-slot={state === 'submenu' ? 'menu-sub-chevron' : 'menu-item-indicator'}
      aria-hidden="true"
      className={cn(
        OPTION_LIST_END_SLOT_CLASS,
        state !== 'submenu' && 'text-primary-ink',
        className,
      )}
    >
      {state !== 'empty' && (
        <Glyph size={16} className={state === 'submenu' ? 'size-4 rtl:rotate-180' : 'size-4'} />
      )}
    </span>
  );
}
export type ItemProps = React.ComponentProps<typeof Primitive.Item> & {
  destructive?: boolean;
  leading?: React.ReactNode;
  closeOnSelect?: boolean;
  'data-slot'?: string;
};
export function Item({
  destructive = false,
  leading,
  closeOnSelect = true,
  onSelect,
  className,
  children,
  ...props
}: ItemProps) {
  return (
    <Primitive.Item
      {...props}
      data-slot={props['data-slot'] ?? 'menu-item'}
      data-menu-item
      data-destructive={destructive ? '' : undefined}
      className={cn(
        menuItem(),
        'data-[destructive]:text-danger data-[destructive]:focus:text-danger',
        className,
      )}
      onSelect={(event) => {
        onSelect?.(event);
        if (!closeOnSelect) event.preventDefault();
      }}
    >
      <Leading>{leading}</Leading>
      {children}
    </Primitive.Item>
  );
}
export function CommandItem({
  icon: IconComponent,
  iconWeight,
  label,
  shortcut,
  destructive,
  disabled,
  disabledReason,
  'aria-describedby': describedBy,
  ...props
}: Omit<ItemProps, 'children' | 'leading'> & {
  icon?: Icon;
  iconWeight?: IconWeight;
  label: string;
  shortcut?: string;
  disabledReason?: string;
}) {
  const id = React.useId();
  return (
    <Item
      {...props}
      destructive={destructive}
      disabled={disabled || disabledReason !== undefined}
      aria-describedby={
        [describedBy, disabledReason ? id : undefined].filter(Boolean).join(' ') || undefined
      }
      leading={
        IconComponent && (
          <IconComponent
            size={16}
            weight={iconWeight}
            className={
              destructive ? 'size-4 text-current' : 'size-4 text-muted-foreground opacity-70'
            }
          />
        )
      }
      data-slot="menu-command-item"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {disabledReason && (
          <span id={id} className="block text-muted-foreground" aria-hidden="true">
            {disabledReason}
          </span>
        )}
      </span>
      {shortcut && (
        <span className="ml-5 flex h-lh shrink-0 items-center" aria-hidden="true">
          <ShortcutChip>{shortcut}</ShortcutChip>
        </span>
      )}
    </Item>
  );
}
const CheckboxGroupContext = React.createContext<{
  value: string[];
  onValueChange: (value: string[]) => void;
} | null>(null);
export function CheckboxGroup({
  value: controlled,
  defaultValue = [],
  onValueChange,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Group>, 'defaultValue'> & {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}) {
  const [local, setLocal] = React.useState(defaultValue);
  const value = controlled ?? local;
  return (
    <CheckboxGroupContext
      value={{
        value,
        onValueChange: (next) => {
          setLocal(next);
          onValueChange?.(next);
        },
      }}
    >
      <Group {...props}>{children}</Group>
    </CheckboxGroupContext>
  );
}
export function CheckboxItem({
  checked: controlled,
  defaultChecked = false,
  indeterminate = false,
  onCheckedChange,
  onIndeterminateChange,
  value,
  leading,
  closeOnSelect = false,
  onSelect,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Primitive.CheckboxItem>, 'defaultChecked'> & {
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onIndeterminateChange?: (value: boolean) => void;
  value?: string;
  leading?: React.ReactNode;
  closeOnSelect?: boolean;
}) {
  const group = React.useContext(CheckboxGroupContext);
  const [local, setLocal] = React.useState(defaultChecked);
  const checked = indeterminate
    ? 'indeterminate'
    : (controlled ?? (value !== undefined && group ? group.value.includes(value) : local));
  return (
    <Primitive.CheckboxItem
      {...props}
      checked={checked}
      onCheckedChange={(next) => {
        setLocal(next === true);
        onCheckedChange?.(next);
        if (indeterminate) onIndeterminateChange?.(false);
        if (value !== undefined && group)
          group.onValueChange(
            next
              ? [...group.value.filter((entry) => entry !== value), value]
              : group.value.filter((entry) => entry !== value),
          );
      }}
      data-slot="menu-checkbox-item"
      data-menu-item
      className={cn(menuItem(), className)}
      onSelect={(event) => {
        onSelect?.(event);
        if (!closeOnSelect) event.preventDefault();
      }}
    >
      <Leading>{leading}</Leading>
      {children}
      <Indicator state={checked === 'indeterminate' ? 'mixed' : checked ? 'checked' : 'empty'} />
    </Primitive.CheckboxItem>
  );
}
export function RadioItem({
  leading,
  closeOnSelect = false,
  onSelect,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.RadioItem> & {
  leading?: React.ReactNode;
  closeOnSelect?: boolean;
}) {
  return (
    <Primitive.RadioItem
      {...props}
      data-slot="menu-radio-item"
      data-menu-item
      className={cn(menuItem(), className)}
      onSelect={(event) => {
        onSelect?.(event);
        if (!closeOnSelect) event.preventDefault();
      }}
    >
      <Leading>{leading}</Leading>
      {children}
      <span
        data-slot="menu-item-indicator"
        className={cn(OPTION_LIST_END_SLOT_CLASS, 'text-primary-ink')}
        aria-hidden="true"
      >
        <Primitive.ItemIndicator>
          <CheckIcon size={16} className="size-4" />
        </Primitive.ItemIndicator>
      </span>
    </Primitive.RadioItem>
  );
}
export function SubTrigger({
  ref,
  icon: IconComponent,
  iconWeight,
  leading,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubTrigger> & {
  icon?: Icon;
  iconWeight?: IconWeight;
  leading?: React.ReactNode;
}) {
  const setTrigger = React.useContext(SubContext)?.setTrigger;
  const triggerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setTrigger?.(node);
      return assignRef(ref, node);
    },
    [ref, setTrigger],
  );
  return (
    <Primitive.SubTrigger
      {...props}
      ref={triggerRef}
      data-slot="menu-sub-trigger"
      data-menu-item
      className={cn(menuItem(), className)}
    >
      <Leading>
        {leading ??
          (IconComponent && (
            <IconComponent
              size={16}
              weight={iconWeight}
              className="size-4 text-muted-foreground opacity-70"
            />
          ))}
      </Leading>
      {children}
      <Indicator state="submenu" />
    </Primitive.SubTrigger>
  );
}
export function Label({
  icon: IconComponent,
  iconWeight,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Label> & { icon?: Icon; iconWeight?: IconWeight }) {
  return (
    <Primitive.Label
      {...props}
      data-slot="menu-label"
      className={cn(
        OPTION_LIST_ROW_CLASS,
        'flex items-start gap-2 font-medium text-muted-foreground',
        className,
      )}
    >
      <Leading>
        {IconComponent && (
          <IconComponent
            size={16}
            weight={iconWeight}
            className="size-4 text-muted-foreground opacity-70"
          />
        )}
      </Leading>
      {children}
    </Primitive.Label>
  );
}
export function Separator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      {...props}
      data-slot="menu-separator"
      className={cn('-mx-1 my-1.5 h-px bg-border', className)}
    />
  );
}
export function ActionRow({
  leading,
  title,
  description,
  trailing,
  selected = false,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'title' | 'children'> & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      data-slot="menu-action-row"
      data-selected={selected ? '' : undefined}
      className={cn(
        menuItem(),
        'items-start whitespace-normal text-foreground hover:bg-hover active:bg-active focus-visible:bg-hover focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        selected && 'bg-selected hover:bg-selected focus-visible:bg-selected',
        className,
      )}
    >
      {leading && (
        <span data-slot="action-row-leading" className="first-line-icon w-4">
          {leading}
        </span>
      )}
      <span data-slot="action-row-content" className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span data-slot="action-row-title" className="min-w-0 break-words">
          {title}
        </span>
        {description && (
          <span
            data-slot="action-row-description"
            className="min-w-0 break-words text-muted-foreground"
          >
            {description}
          </span>
        )}
      </span>
      {trailing && (
        <span data-slot="action-row-trailing" className="first-line-icon gap-2">
          {trailing}
        </span>
      )}
    </button>
  );
}
export interface StackedMenuItem {
  id: string;
  label: string;
  icon?: Icon;
  shortcut?: string;
  disabled?: boolean;
  when?: boolean;
  destructive?: boolean;
  className?: string;
  onSelect?: (event: Event) => void;
  items?: StackedMenuItem[];
  content?: React.ReactNode;
}
export interface StackedMenuGroup {
  id: string;
  label?: string;
  items: StackedMenuItem[];
}
function visibleItems(items: StackedMenuItem[]): StackedMenuItem[] {
  return items.flatMap((item) => {
    if (item.when === false) return [];
    if (!item.items || item.content) return [item];
    const children = visibleItems(item.items);
    return children.length ? [{ ...item, items: children }] : [];
  });
}
function StackedItems({
  items,
  submenuClass,
}: {
  items: StackedMenuItem[];
  submenuClass?: string;
}) {
  return items.map((item) =>
    item.items?.length || item.content ? (
      <Sub key={item.id}>
        <SubTrigger icon={item.icon} disabled={item.disabled} className={item.className}>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut && (
            <span className="ml-5 flex h-lh shrink-0 items-center" aria-hidden="true">
              <ShortcutChip>{item.shortcut}</ShortcutChip>
            </span>
          )}
        </SubTrigger>
        <SubContent className={submenuClass}>
          {item.content ?? <StackedItems items={item.items ?? []} submenuClass={submenuClass} />}
        </SubContent>
      </Sub>
    ) : (
      <CommandItem
        key={item.id}
        icon={item.icon}
        label={item.label}
        shortcut={item.shortcut}
        disabled={item.disabled}
        destructive={item.destructive}
        className={item.className}
        onSelect={item.onSelect}
      />
    ),
  );
}
export function StackedContent({
  groups,
  submenuClass,
  className,
  ...props
}: ContentProps & { groups: StackedMenuGroup[]; submenuClass?: string }) {
  const visible = groups
    .map((group) => ({ ...group, items: visibleItems(group.items) }))
    .filter((group) => group.items.length);
  return (
    <Content {...props} className={cn('w-60', className)}>
      {visible.map((group, index) => (
        <React.Fragment key={group.id}>
          {index > 0 && <Separator />}
          <Group aria-label={group.label} data-slot="menu-stack-group">
            {group.label && <Label>{group.label}</Label>}
            <StackedItems items={group.items} submenuClass={submenuClass} />
          </Group>
        </React.Fragment>
      ))}
    </Content>
  );
}
export { Root as Menu, Item as MenuItem, Sub as MenuSub };

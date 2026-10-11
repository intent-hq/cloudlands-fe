/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Custom listbox supports rich options and nested menu triggers, which native select/option cannot host. */
// Source: ui/dropdown/Dropdown.svelte. A searchable listbox; nested actions use canonical menus.
import * as React from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import * as Menu from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
import type {
  DropdownOption,
  DropdownGroup,
  DropdownItemProps,
  DropdownGroupProps,
  DropdownTriggerVariant,
  DropdownTriggerSize,
} from './types';
export type {
  DropdownOption,
  DropdownGroup,
  DropdownItemProps,
  DropdownGroupProps,
  DropdownTriggerVariant,
  DropdownTriggerSize,
} from './types';
const { formatInteger } = createFormatters(getLocale);
const noOptions: DropdownOption[] = [];
const noGroups: DropdownGroup[] = [];
export interface DropdownHandle {
  openAndFocusSearch(): void;
  focusTrigger(): void;
  dismissAndFocusTrigger(): void;
}
export interface DropdownProps {
  ref?: React.Ref<DropdownHandle>;
  value?: string | string[];
  defaultValue?: string | string[];
  options?: DropdownOption[];
  groups?: DropdownGroup[];
  placeholder?: string;
  portal?: boolean;
  staticPosition?: boolean;
  animate?: boolean;
  collisionBoundary?: string | HTMLElement | null;
  collisionPadding?: number;
  searchable?: boolean;
  searchChrome?: boolean;
  searchValue?: string;
  onSearchValueChange?: (search: string) => void;
  multiple?: boolean;
  closeOnSelect?: boolean;
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  variant?: DropdownTriggerVariant;
  size?: DropdownTriggerSize;
  className?: string;
  triggerClass?: string;
  contentClass?: string;
  contentMaxHeight?: number;
  fillContentHeight?: boolean;
  headerClass?: string;
  onChange?: (value: string | string[], event?: MouseEvent) => void;
  onOpenChange?: (open: boolean) => void;
  trigger?: (state: { open: boolean; value: string | string[] | undefined }) => React.ReactNode;
  item?: (state: DropdownItemProps) => React.ReactNode;
  groupHeader?: (state: DropdownGroupProps) => React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  empty?: React.ReactNode;
  defaultHighlightValue?: string;
}
function deduplicate(options: DropdownOption[]) {
  const values = new Set<string>();
  return options.filter((option) => {
    if (values.has(option.value)) return false;
    values.add(option.value);
    return true;
  });
}
function NestedOptions({
  options,
  owner,
  onSelect,
  selected,
  item,
}: {
  options: DropdownOption[];
  owner: string;
  onSelect: (option: DropdownOption, event?: MouseEvent) => void;
  selected: (value: string) => boolean;
  item?: DropdownProps['item'];
}) {
  return deduplicate(options).map((option) =>
    option.type === 'separator' ? (
      <Menu.Separator key={option.value} />
    ) : option.type === 'submenu' && option.children?.length ? (
      <Menu.Sub key={option.value}>
        <Menu.SubTrigger icon={option.icon} disabled={option.disabled}>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
        </Menu.SubTrigger>
        <Menu.SubContent data-dropdown-owner={owner}>
          <NestedOptions
            options={option.children}
            owner={owner}
            onSelect={onSelect}
            selected={selected}
            item={item}
          />
        </Menu.SubContent>
      </Menu.Sub>
    ) : (
      <Menu.Item
        key={option.value}
        disabled={option.disabled}
        className={option.className}
        textValue={option.label}
        closeOnSelect={false}
        onSelect={() => onSelect(option)}
      >
        {item ? (
          item({ option, selected: selected(option.value), highlighted: false })
        ) : (
          <OptionContent option={option} selected={selected(option.value)} multiple={false} />
        )}
      </Menu.Item>
    ),
  );
}
function OptionContent({
  option,
  selected,
  multiple,
}: {
  option: DropdownOption;
  selected: boolean;
  multiple: boolean;
}) {
  const IconComponent = option.icon;
  return (
    <>
      {(option.type === 'toggle' || multiple) && (
        <Menu.Indicator
          state={(option.type === 'toggle' ? option.checked : selected) ? 'checked' : 'empty'}
        />
      )}
      {option.avatar && <img src={option.avatar} alt="" className="size-5 shrink-0 rounded-full" />}
      {IconComponent && <IconComponent size={16} className="size-4 shrink-0 text-ghost" />}
      <span className="min-w-0 flex-1 truncate">
        {option.label}
        {option.description && <span className="text-subtle"> · {option.description}</span>}
      </span>
      {option.endLabel && <span className="text-ui text-subtle">{option.endLabel}</span>}
      {option.shortcut && <span className="text-xs text-subtle">{option.shortcut}</span>}
      {option.type === 'submenu' ? (
        <CaretRightIcon size={12} className="size-3 shrink-0 text-ghost" />
      ) : !multiple && !option.type && selected ? (
        <CheckIcon size={16} className="size-4 shrink-0 text-foreground" />
      ) : null}
    </>
  );
}
export function Dropdown({
  ref,
  value: controlledValue,
  defaultValue,
  options = noOptions,
  groups = noGroups,
  placeholder = m.ui_dropdown_select_placeholder(),
  portal = false,
  staticPosition = false,
  animate = true,
  collisionBoundary = null,
  collisionPadding = 8,
  searchable = true,
  searchChrome = false,
  searchValue: controlledSearch,
  onSearchValueChange,
  multiple = false,
  closeOnSelect = true,
  disabled = false,
  open: controlledOpen,
  defaultOpen = false,
  variant = 'default',
  size = 'md',
  className,
  triggerClass,
  contentClass,
  contentMaxHeight,
  fillContentHeight = false,
  headerClass,
  onChange,
  onOpenChange,
  trigger,
  item,
  groupHeader,
  header,
  footer,
  empty,
  defaultHighlightValue,
}: DropdownProps) {
  const uid = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const pinWidth = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node && !staticPosition) {
        node.style.removeProperty('width');
        node.style.width = `${Math.max(node.offsetWidth, triggerRef.current?.offsetWidth ?? 0)}px`;
      }
    },
    [staticPosition],
  );
  const input = React.useRef<HTMLInputElement>(null);
  const viewport = React.useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const [localSearch, setLocalSearch] = React.useState('');
  const [navigation, setNavigation] = React.useState<{ inputs: readonly unknown[]; index: number }>(
    { inputs: [], index: -1 },
  );
  const [submenu, setSubmenu] = React.useState<string | null>(null);
  const value = controlledValue ?? localValue;
  const open = controlledOpen ?? localOpen;
  const search = controlledSearch ?? localSearch;
  const all = React.useMemo(
    () => (groups.length ? groups.flatMap((group) => group.options) : options),
    [groups, options],
  );
  const terms = React.useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const filteredOptions = React.useMemo(
    () =>
      deduplicate(options).filter((option) =>
        terms.every((term) =>
          `${option.label} ${option.description ?? ''}`.toLowerCase().includes(term),
        ),
      ),
    [options, terms],
  );
  const filteredGroups = React.useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          options: deduplicate(group.options).filter((option) =>
            terms.every((term) =>
              `${group.label} ${group.searchLabel ?? ''} ${option.label} ${option.description ?? ''}`
                .toLowerCase()
                .includes(term),
            ),
          ),
        }))
        .filter((group) => group.options.length),
    [groups, terms],
  );
  const shown = React.useMemo(
    () => (groups.length ? filteredGroups.flatMap((group) => group.options) : filteredOptions),
    [groups.length, filteredGroups, filteredOptions],
  );
  const hoverOptions = React.useMemo(
    () => shown.filter((option) => option.type !== 'separator' && !option.disabled),
    [shown],
  );
  const selectable = React.useMemo(
    () => hoverOptions.filter((option) => option.type !== 'submenu'),
    [hoverOptions],
  );
  const selected = (key: string) => (Array.isArray(value) ? value.includes(key) : value === key);
  const setSearch = (next: string) => {
    setLocalSearch(next);
    onSearchValueChange?.(next);
  };
  const changeOpen = (next: boolean) => {
    if (disabled && next) return;
    setLocalOpen(next);
    if (!next) {
      setSearch('');
      setSubmenu(null);
      setHighlight(-1);
    }
    if (next !== open) onOpenChange?.(next);
  };
  const navigationInputs = [open, search, selectable, value, defaultHighlightValue];
  let highlight = navigation.index;
  if (navigationInputs.some((entry, index) => entry !== navigation.inputs[index])) {
    const key = typeof value === 'string' ? value : value?.length === 1 ? value[0] : undefined;
    const current = selectable.findIndex((option) => option.value === key);
    const fallback = selectable.findIndex((option) => option.value === defaultHighlightValue);
    highlight = !open ? -1 : search ? 0 : current >= 0 ? current : Math.max(0, fallback);
    setNavigation({ inputs: navigationInputs, index: highlight });
  }
  const setHighlight = (index: number) => setNavigation((current) => ({ ...current, index }));
  React.useLayoutEffect(() => {
    if (open && highlight >= 0)
      document.getElementById(`${uid}-option-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, uid, highlight]);
  const focusOption = (index: number) => {
    const shouldFocus = document.activeElement?.getAttribute('role') === 'option';
    setHighlight(index);
    queueMicrotask(() => {
      const target = document.getElementById(`${uid}-option-${index}`);
      if (shouldFocus) target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    });
  };
  const select = (option: DropdownOption, event?: MouseEvent) => {
    if (
      option.disabled ||
      option.type === 'separator' ||
      (option.type === 'submenu' && option.children?.length)
    )
      return;
    if (option.onClick) {
      option.onClick();
      changeOpen(false);
      return;
    }
    if (option.type === 'toggle') {
      onChange?.(option.value, event);
      return;
    }
    const current = Array.isArray(value) ? value : value ? [value] : [];
    const next = multiple
      ? current.includes(option.value)
        ? current.filter((key) => key !== option.value)
        : [...current, option.value]
      : option.value;
    setLocalValue(next);
    onChange?.(next, event);
    if (!multiple && closeOnSelect) changeOpen(false);
  };
  const keydown: React.KeyboardEventHandler<HTMLElement> = (event) => {
    if (!open || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest('[data-dropdown-header],[data-dropdown-footer]') && event.key !== 'Escape')
      return;
    if (target.closest('[data-dropdown-owner]')) return;
    let index = highlight;
    if (event.key === 'ArrowDown') index = Math.min(highlight + 1, selectable.length - 1);
    else if (event.key === 'ArrowUp') index = Math.max(highlight - 1, 0);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = selectable.length - 1;
    else if (event.key === 'PageDown' || event.key === 'PageUp') {
      if (viewport.current)
        index = Menu.getPageTargetIndex(
          Array.from(viewport.current.querySelectorAll<HTMLElement>('[role="option"][id]')),
          highlight,
          viewport.current,
          event.key === 'PageDown' ? 1 : -1,
        );
    } else if (event.key === 'Enter') {
      if (selectable[highlight]) select(selectable[highlight]);
    } else if (event.key === 'Escape') {
      changeOpen(false);
      triggerRef.current?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (index !== highlight) focusOption(index);
  };
  React.useImperativeHandle(ref, () => ({
    openAndFocusSearch() {
      changeOpen(true);
      requestAnimationFrame(() => input.current?.focus());
    },
    focusTrigger() {
      triggerRef.current?.focus();
    },
    dismissAndFocusTrigger() {
      changeOpen(false);
      queueMicrotask(() => triggerRef.current?.focus());
    },
  }));
  const boundary =
    typeof collisionBoundary === 'string'
      ? typeof document === 'undefined'
        ? null
        : document.querySelector<HTMLElement>(collisionBoundary)
      : collisionBoundary;
  let display: string | undefined;
  if (Array.isArray(value))
    display =
      value.length > 1
        ? m.ui_dropdown_selected_many({ count: formatInteger(value.length) })
        : all.find((option) => option.value === value[0])?.label;
  else display = all.find((option) => option.value === value)?.label;
  const renderOption = (option: DropdownOption) => {
    if (option.type === 'separator') return <Menu.Separator key={option.value} />;
    const index = selectable.indexOf(option);
    const highlighted = index >= 0 && index === highlight;
    const button = (
      <Button
        variant="plain"
        wrapContent={false}
        type="button"
        id={index >= 0 ? `${uid}-option-${index}` : undefined}
        disabled={option.disabled}
        data-disabled={option.disabled ? '' : undefined}
        data-highlighted={highlighted ? 'true' : undefined}
        data-menu-item
        className={cn(Menu.menuItem(), 'h-auto gap-1.5 overflow-hidden', option.className)}
        style={{ scrollMarginTop: 'var(--control-height-medium)' }}
        role="option"
        aria-selected={selected(option.value)}
        tabIndex={highlighted && !option.disabled ? 0 : -1}
        onClick={(event) => select(option, event.nativeEvent)}
      >
        {item ? (
          item({ option, selected: selected(option.value), highlighted })
        ) : (
          <OptionContent option={option} selected={selected(option.value)} multiple={multiple} />
        )}
      </Button>
    );
    if (option.type !== 'submenu' || !option.children?.length)
      return <React.Fragment key={option.value}>{button}</React.Fragment>;
    return (
      <Menu.Root
        key={option.value}
        open={submenu === option.value}
        onOpenChange={(next) => setSubmenu(next ? option.value : null)}
        modal={false}
      >
        <Menu.Trigger
          asChild
          onFocus={() => {
            if (!option.disabled) setSubmenu(option.value);
          }}
          onPointerMove={(event) => {
            if (event.pointerType !== 'touch' && !option.disabled) setSubmenu(option.value);
          }}
        >
          {button}
        </Menu.Trigger>
        <Menu.Content
          side="right"
          align="start"
          alignOffset={Menu.menuSubmenuAlignOffset}
          data-dropdown-owner={uid}
          aria-label={option.label}
          onOpenAutoFocus={(event) => {
            if (
              document.activeElement !== triggerRef.current &&
              document.activeElement?.getAttribute('role') !== 'option'
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <NestedOptions
            options={option.children}
            owner={uid}
            onSelect={select}
            selected={selected}
            item={item}
          />
        </Menu.Content>
      </Menu.Root>
    );
  };
  return (
    <div data-slot="dropdown-root" className={cn('relative inline-block', className)}>
      <Popover open={open} onOpenChange={changeOpen} staticPosition={staticPosition}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={`${uid}-trigger`}
            disabled={disabled}
            active={open}
            variant={variant === 'inline' ? 'plain' : variant}
            size={size === 'md' ? 'default' : size}
            className={cn(
              'type-caption inline-flex cursor-pointer items-center gap-2 rounded-(--radius-medium)',
              variant === 'inline' && 'h-auto p-0',
              triggerClass,
            )}
            aria-haspopup="listbox"
            aria-controls={open ? `${uid}-listbox` : undefined}
            onKeyDown={keydown}
          >
            {trigger ? (
              trigger({ open, value })
            ) : (
              <>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-left',
                    !display && 'text-muted-foreground',
                  )}
                >
                  {display ?? placeholder}
                </span>
                <CaretDownIcon size={16} className="size-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={pinWidth}
          portal={portal}
          collisionBoundary={boundary}
          collisionPadding={collisionPadding}
          align="start"
          data-slot="dropdown-content"
          className={cn('flex w-max min-w-(--radix-popover-trigger-width) flex-col', contentClass)}
          style={{
            maxHeight: contentMaxHeight ?? 'var(--radix-popover-content-available-height)',
            ...(!animate ? { animation: 'none' } : {}),
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (searchable) input.current?.focus();
          }}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-dropdown-owner]')?.getAttribute('data-dropdown-owner') ===
                uid
            )
              event.preventDefault();
          }}
          onKeyDown={keydown}
        >
          {header && (
            <div
              data-dropdown-header
              className={cn('shrink-0 border-b border-border', headerClass)}
            >
              {header}
            </div>
          )}
          {searchable && (
            <>
              <div className={cn('w-full shrink-0', searchChrome && 'relative p-2')}>
                {searchChrome && (
                  <MagnifyingGlassIcon
                    size={12}
                    className="pointer-events-none absolute top-1/2 left-4.5 size-3 -translate-y-1/2 text-subtle"
                  />
                )}
                <Input
                  ref={input}
                  type="text"
                  role="searchbox"
                  aria-label={m.ui_dropdown_search_ariaLabel()}
                  aria-controls={`${uid}-listbox`}
                  aria-activedescendant={
                    selectable[highlight] ? `${uid}-option-${highlight}` : undefined
                  }
                  placeholder={placeholder}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  noFocusStyle
                  className={
                    searchChrome
                      ? 'pl-7'
                      : 'w-full border-none bg-transparent px-3 py-2 text-sm outline-none ring-0 focus:outline-none!'
                  }
                />
              </div>
              {search && (
                <output className="sr-only" aria-live="polite" aria-atomic="true">
                  {selectable.length === 1
                    ? m.ui_dropdown_resultsFound_one()
                    : m.ui_dropdown_resultsFound_many({ count: formatInteger(selectable.length) })}
                </output>
              )}
            </>
          )}
          <div
            ref={viewport}
            id={`${uid}-listbox`}
            data-scroll-container
            role="listbox"
            aria-labelledby={`${uid}-trigger`}
            aria-multiselectable={multiple || undefined}
            tabIndex={-1}
            className={cn(
              'relative isolate overflow-y-auto p-1',
              portal || fillContentHeight ? 'min-h-0 flex-1' : 'max-h-[300px]',
            )}
          >
            <Menu.ListHighlight
              activeIndex={
                hoverOptions.indexOf(selectable[highlight]) < 0
                  ? null
                  : hoverOptions.indexOf(selectable[highlight])
              }
              onActiveIndexChange={(index) => {
                if (index !== null) setHighlight(selectable.indexOf(hoverOptions[index]));
              }}
            />
            {groups.length
              ? filteredGroups.map((group, groupIndex) => (
                  <div key={group.key} role="group" aria-label={group.label}>
                    {groupHeader
                      ? groupHeader({ group, groupIndex })
                      : group.label && (
                          <div
                            className={cn(
                              'type-caption sticky top-0 z-10 bg-popover px-2 py-1 text-xs font-medium text-muted-foreground',
                              groupIndex > 0 && 'border-t border-border pt-3',
                            )}
                          >
                            {group.label}
                          </div>
                        )}
                    {group.options.map(renderOption)}
                  </div>
                ))
              : filteredOptions.map(renderOption)}
            {shown.length === 0 &&
              (search && all.length ? (
                <div className="type-caption flex flex-col items-start gap-1 px-2 py-1 text-left text-muted-foreground">
                  <span>{m.ui_dropdown_noResultsFor_label({ query: search })}</span>
                  <span>{m.ui_dropdown_tryDifferentSearch_description()}</span>
                </div>
              ) : (
                (empty ?? (
                  <div className="type-caption min-h-(--control-height-small) px-2 py-1 text-left text-muted-foreground">
                    {m.ui_dropdown_noResults_label()}
                  </div>
                ))
              ))}
          </div>
          {footer && (
            <div
              data-dropdown-footer
              className={cn('border-t border-border', portal ? 'shrink-0' : 'px-2 py-2.5')}
            >
              {footer}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

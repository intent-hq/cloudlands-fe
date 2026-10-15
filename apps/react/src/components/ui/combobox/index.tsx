/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The composite listbox owns option groups separately from interactive group headings. */
// Source: ui/combobox/combobox.svelte. Primitive composition follows official shadcn Combobox.
import * as React from 'react';
import { Combobox as Primitive } from '@base-ui/react/combobox';
import { m } from '$shared/paraglide/messages.js';
import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
import { OVERLAY_VIEWPORT_GUTTER } from '$lib/components/ui/overlay-positioning';
import { Button } from '@/components/ui/button';
import { useDialogPortalTarget } from '@/components/ui/dialog';
import {
  getPageTargetIndex,
  Indicator,
  ListHighlight,
  menuItem,
  menuOverlay,
} from '@/components/ui/menu';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import { useSize } from '@/components/ui/size-context';
import { textEntryControlClasses, textEntryHeight } from '@/components/ui/text-entry';
import { cn } from '@/lib/utils';
import { useFocusScopeRef } from '@/lib/interaction/focus-scope';
import type { ComboboxGroup, ComboboxOption, ComboboxProps } from './types';

export type { ComboboxGroup, ComboboxOption, ComboboxProps } from './types';
const emptyOptions: ComboboxOption[] = [];
const emptyGroups: ComboboxGroup[] = [];
const nestedControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"]',
    ),
  );

export function Combobox({
  value: controlledValue,
  defaultValue,
  options = emptyOptions,
  groups = emptyGroups,
  multiple = false,
  open: controlledOpen,
  defaultOpen = false,
  disabled = false,
  invalid = false,
  size,
  loading = false,
  portal = true,
  staticPosition = false,
  side = 'bottom',
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  placeholder = m.ui_combobox_selectOption_placeholder(),
  searchPlaceholder = m.ui_combobox_searchOptions_placeholder(),
  emptyText = m.ui_combobox_noOptions_message(),
  errorText = m.ui_combobox_searchFailed_error(),
  retryText = m.ui_combobox_retry_label(),
  className,
  inputClass,
  inputRef,
  contentClass,
  displayValue,
  allowCustom = false,
  header,
  headerAction,
  footer,
  optionDescription,
  optionActions,
  groupDescription,
  groupAction,
  onSearch,
  onQueryChange,
  onSearchError,
  onChange,
  onCommit,
  onOpenChange,
}: ComboboxProps) {
  const uid = React.useId();
  const dialogPortalTarget = useDialogPortalTarget();
  const surface = clampSurface(useSurface() + 2);
  const contextSize = useSize();
  const resolvedSize = size ?? contextSize;
  const [localValue, setLocalValue] = React.useState<string | string[]>(
    defaultValue ?? (multiple ? [] : ''),
  );
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const value = controlledValue ?? localValue;
  const open = !disabled && (controlledOpen ?? localOpen);
  const [query, setQuery] = React.useState('');
  const queryRef = React.useRef('');
  const [searchedGroups, setSearchedGroups] = React.useState<ComboboxGroup[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchFailed, setSearchFailed] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string>();
  const generation = React.useRef(0);
  const [labels, setLabels] = React.useState(() => new Map<string, string>());
  const input = React.useRef<HTMLInputElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const [inlinePortalTarget, setInlinePortalTarget] = React.useState<HTMLDivElement | null>(null);
  const setRootNode = React.useCallback((node: HTMLDivElement | null) => {
    root.current = node;
    setInlinePortalTarget(node);
  }, []);
  const content = React.useRef<HTMLDivElement>(null);
  const scopeRef = useFocusScopeRef({ enabled: open }, content);
  const viewport = React.useRef<HTMLDivElement>(null);
  const retry = React.useRef<HTMLButtonElement>(null);
  const suppressFocusOpen = React.useRef(false);
  const busy = loading || searching;
  const baseGroups = React.useMemo(
    () => (groups.length ? groups : [{ key: 'options', label: '', options }]),
    [groups, options],
  );
  const available = React.useMemo(
    () => [...baseGroups, ...(searchedGroups ?? [])].flatMap((group) => group.options),
    [baseGroups, searchedGroups],
  );
  const selectedValues = Array.isArray(value) ? value : [value];
  const selectedInputValue =
    displayValue ??
    selectedValues
      .map(
        (id) =>
          baseGroups.flatMap((group) => group.options).find((option) => option.value === id)
            ?.label ??
          labels.get(id) ??
          available.find((option) => option.value === id)?.label ??
          id,
      )
      .filter(Boolean)
      .join(', ');

  React.useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Preserve labels from externally supplied result windows after those options disappear.
    setLabels((previous) => {
      const remembered = new Map<string, string>();
      for (const id of Array.isArray(value) ? value : [value]) {
        remembered.set(
          id,
          available.find((option) => option.value === id)?.label ?? previous.get(id) ?? id,
        );
      }
      return remembered.size === previous.size &&
        [...remembered].every(([id, label]) => previous.get(id) === label)
        ? previous
        : remembered;
    });
  }, [value, available]);
  React.useImperativeHandle(inputRef, () => input.current!, []);
  React.useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  function resetSearch() {
    generation.current += 1;
    const hadQuery = queryRef.current !== '';
    queryRef.current = '';
    setQuery('');
    setSearchedGroups(null);
    setSearching(false);
    setSearchFailed(false);
    setHighlighted(undefined);
    if (hadQuery) onQueryChange?.('');
  }
  const previousOpen = React.useRef(open);
  React.useLayoutEffect(() => {
    if (previousOpen.current && !open) resetSearch();
    previousOpen.current = open;
  });

  function changeOpen(next: boolean) {
    if (next === open || (next && disabled)) return;
    if (!next) resetSearch();
    setLocalOpen(next);
    onOpenChange?.(next);
  }
  function focusInput() {
    suppressFocusOpen.current = true;
    input.current?.focus({ preventScroll: true });
    suppressFocusOpen.current = false;
  }

  // Run before host Radix document listeners. The picker consumes one Escape;
  // a compact host explicitly closes itself through onOpenChange(false).
  React.useEffect(() => {
    if (!open) return;
    const document = input.current?.ownerDocument;
    const window = document?.defaultView;
    if (!document || !window) return;
    const contains = (target: EventTarget | null) =>
      target instanceof Node &&
      (root.current?.contains(target) || content.current?.contains(target));
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        event.defaultPrevented ||
        !contains(event.target)
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-combobox-owner]')?.getAttribute('data-combobox-owner') !== uid
      )
        return;
      if (event.target instanceof Element && event.target.closest('[data-combobox-local-escape]')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusInput();
      changeOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!contains(event.target)) changeOpen(false);
    };
    // Source floating and static content dismiss on outside pointer or explicit
    // keyboard actions, not programmatic focus changes to another control.
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside);
    };
  });

  async function runSearch(nextQuery: string) {
    const current = ++generation.current;
    setSearchFailed(false);
    setSearchedGroups(null);
    if (!onSearch || !nextQuery.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const result = await onSearch(nextQuery);
      if (current !== generation.current) return;
      setSearchedGroups(
        result.length && 'options' in result[0]
          ? (result as ComboboxGroup[])
          : [{ key: 'search-results', label: '', options: result as ComboboxOption[] }],
      );
    } catch (error) {
      if (current !== generation.current) return;
      setSearchFailed(true);
      onSearchError?.(error, nextQuery);
    } finally {
      if (current === generation.current) setSearching(false);
    }
  }
  function retrySearch() {
    focusInput();
    void runSearch(queryRef.current);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const customValue = query.trim();
  const customOption: ComboboxOption | null =
    allowCustom &&
    customValue &&
    !busy &&
    !available.some(
      (option) =>
        option.value.toLowerCase() === normalizedQuery ||
        option.label.toLowerCase() === normalizedQuery,
    )
      ? { value: customValue, label: customValue }
      : null;
  const normalizedGroups = customOption
    ? [...(searchedGroups ?? baseGroups), { key: 'custom', label: '', options: [customOption] }]
    : (searchedGroups ?? baseGroups);
  const filteredGroups = normalizedGroups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (option) =>
          !normalizedQuery ||
          `${option.label} ${option.description ?? ''}`.toLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.options.length);
  const visibleOptions = loading
    ? []
    : filteredGroups.flatMap((group) => (group.collapsed && !normalizedQuery ? [] : group.options));
  const itemValues = visibleOptions.map((option) => option.value);
  const enabledOptions = busy ? [] : visibleOptions.filter((option) => !option.disabled);
  const labelId = `${uid}-label`;
  const listboxId = `${uid}-listbox`;
  const accessibleLabel = ariaLabelledby || labelId;
  const groupId = (key: string) => `${uid}-group-${encodeURIComponent(key)}`;
  const optionId = (id: string) => `${uid}-option-${encodeURIComponent(id)}`;
  const activeOption =
    enabledOptions.find((option) => option.value === highlighted) ??
    (!normalizedQuery
      ? enabledOptions.find((option) => selectedValues.includes(option.value))
      : undefined) ??
    enabledOptions[0];
  const activeId = open && activeOption ? optionId(activeOption.value) : undefined;
  React.useLayoutEffect(() => {
    if (activeId)
      input.current?.ownerDocument.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // Bits uses Home/End for option navigation; Base UI uses them for caret movement.
  // Keep one source-compatible navigation owner for both the input and viewport.
  function navigate(
    event: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler: () => void },
  ) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      event.preventBaseUIHandler();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter'].includes(event.key))
      return;
    if (!open && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.preventBaseUIHandler();
    event.stopPropagation();
    if (!open) {
      changeOpen(true);
      return;
    }
    if (event.key === 'Enter') {
      if (searchFailed) retrySearch();
      else if (activeOption) accept(activeOption);
      return;
    }
    if (!enabledOptions.length) return;
    const current = enabledOptions.findIndex((option) => option === activeOption);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabledOptions.length - 1;
    else if (event.key === 'ArrowDown') next = (current + 1) % enabledOptions.length;
    else if (event.key === 'ArrowUp')
      next = (current - 1 + enabledOptions.length) % enabledOptions.length;
    else if (viewport.current) {
      const rows = enabledOptions
        .map((option) => input.current?.ownerDocument.getElementById(optionId(option.value)))
        .filter((row): row is HTMLElement => Boolean(row));
      next = getPageTargetIndex(rows, current, viewport.current, event.key === 'PageDown' ? 1 : -1);
    }
    setHighlighted(enabledOptions[next]?.value);
  }

  function accept(option: ComboboxOption) {
    if (busy || disabled || option.disabled || !open) return;
    const nextValue = multiple
      ? selectedValues.includes(option.value)
        ? selectedValues.filter((id) => id !== option.value)
        : [...selectedValues.filter(Boolean), option.value]
      : option.value;
    setLabels((previous) => new Map(previous).set(option.value, option.label));
    setLocalValue(nextValue);
    resetSearch();
    focusInput();
    if (!multiple) changeOpen(false);
    if (multiple) onChange?.(nextValue);
    else if (value !== nextValue) onChange?.(nextValue, option);
    onCommit?.(nextValue, option);
  }

  const body = (
    <>
      {(header || headerAction) && (
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          {header && (
            <span className="type-caption min-w-0 truncate font-medium text-muted-foreground">
              {header}
            </span>
          )}
          {headerAction && <div className="ml-auto">{headerAction}</div>}
        </div>
      )}
      {busy ? (
        <output className="type-body block px-3 py-2 text-muted-foreground">
          {m.ui_combobox_loadingOptions_message()}
        </output>
      ) : searchFailed ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <output className="type-body text-muted-foreground">{errorText}</output>
          <Button
            ref={retry}
            variant="ghost"
            size="sm"
            onClick={retrySearch}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              focusInput();
              if (event.shiftKey) event.preventDefault();
              else changeOpen(false);
            }}
          >
            {retryText}
          </Button>
        </div>
      ) : (
        !filteredGroups.length && (
          <output className="type-body block px-3 py-2 text-muted-foreground">{emptyText}</output>
        )
      )}
      <Primitive.List
        ref={viewport}
        data-combobox-viewport
        id={groupAction ? `${uid}-region` : listboxId}
        role={groupAction ? 'region' : 'listbox'}
        aria-labelledby={accessibleLabel}
        aria-multiselectable={!groupAction && multiple ? true : undefined}
        aria-busy={busy}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget) navigate(event);
        }}
        className={cn(OPTION_LIST_CONTAINER_CLASS, 'max-h-72 overscroll-contain overflow-y-auto')}
      >
        <ListHighlight
          activeIndex={activeOption === undefined ? null : enabledOptions.indexOf(activeOption)}
        />
        {groupAction && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={accessibleLabel}
            aria-multiselectable={multiple || undefined}
            aria-busy={busy}
            className="sr-only"
            aria-owns={
              loading
                ? undefined
                : filteredGroups
                    .filter((group) => !group.collapsed || normalizedQuery)
                    .map((group) => groupId(group.key))
                    .join(' ') || undefined
            }
          />
        )}
        {!loading &&
          filteredGroups.map((group, index) => (
            <React.Fragment key={group.key}>
              {group.separatorBefore && index > 0 && (
                <Primitive.Separator className="my-1 border-t border-border" />
              )}
              {group.label && (
                <div className="type-caption px-2 py-1.5 font-medium text-muted-foreground">
                  <span id={`${groupId(group.key)}-label`}>
                    <span>{group.label}</span>
                    {groupDescription?.(group)}
                  </span>
                  {groupAction?.(group)}
                </div>
              )}
              <Primitive.Group
                id={groupId(group.key)}
                aria-labelledby={group.label ? `${groupId(group.key)}-label` : undefined}
              >
                {(group.collapsed && !normalizedQuery ? [] : group.options).map((option) => (
                  <Primitive.Item
                    key={option.value}
                    render={<div id={optionId(option.value)} />}
                    value={option.value}
                    disabled={busy || option.disabled}
                    data-highlighted={activeOption === option ? '' : undefined}
                    data-menu-item
                    data-slot="combobox-option-motion"
                    className={cn(menuItem(), option.className ?? option.class)}
                    onPointerDownCapture={(event) => {
                      if (nestedControl(event.target)) event.preventBaseUIHandler();
                    }}
                    onMouseDown={(event) => {
                      if (nestedControl(event.target)) event.preventBaseUIHandler();
                    }}
                    onClick={(event) => {
                      event.preventBaseUIHandler();
                      if (!event.defaultPrevented && !nestedControl(event.target)) accept(option);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option === customOption
                        ? m.ui_combobox_useCustom_label({ value: option.label })
                        : option.label}
                    </span>
                    {optionDescription
                      ? optionDescription(option)
                      : option.description && (
                          <span className="type-caption max-w-1/2 shrink-0 truncate text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                    <Indicator
                      state={selectedValues.includes(option.value) ? 'checked' : 'empty'}
                      className={
                        selectedValues.includes(option.value) ? 'opacity-100' : 'opacity-0'
                      }
                    />
                    {optionActions?.(option)}
                  </Primitive.Item>
                ))}
              </Primitive.Group>
            </React.Fragment>
          ))}
      </Primitive.List>
      {footer && (
        <div className="shrink-0 border-t border-border bg-muted/20 px-3 py-2">{footer}</div>
      )}
    </>
  );

  const popup = (
    <Primitive.Positioner
      side={side}
      sideOffset={4}
      align="start"
      collisionPadding={OVERLAY_VIEWPORT_GUTTER}
    >
      {/* The source popup is nonmodal. Base UI Popup hides outside content from
          assistive technology whenever its input is outside the popup, even
          with modal=false. Positioner and List provide the floating/ARIA parts;
          keyboard and outside-pointer actions own dismissal. */}
      <div
        ref={scopeRef}
        role="presentation"
        data-combobox-owner={uid}
        data-surface-level={surface}
        data-state={open ? 'open' : 'closed'}
        className={cn(
          menuOverlay(),
          'w-(--anchor-width) max-h-72 rounded-(--radius-medium)',
          contentClass,
        )}
      >
        {body}
      </div>
    </Primitive.Positioner>
  );

  return (
    <SurfaceProvider level={surface}>
      <div ref={setRootNode} data-combobox-owner={uid} className={cn('relative w-full', className)}>
        <span id={labelId} className="sr-only">
          {ariaLabel}
        </span>
        <Primitive.Root<string, boolean>
          multiple={multiple}
          value={
            multiple
              ? selectedValues.filter(Boolean)
              : typeof value === 'string' && value
                ? value
                : null
          }
          open={open}
          modal={false}
          inline={staticPosition}
          items={itemValues}
          filter={null}
          inputValue={open ? query : selectedInputValue}
          disabled={disabled}
          onItemHighlighted={(item, details) => {
            if (details.reason === 'pointer') setHighlighted(item);
          }}
          onValueChange={(_, details) => details.cancel()}
          onOpenChange={(next, details) => {
            if (details.reason === 'item-press' || (!next && details.reason === 'input-press')) {
              details.cancel();
              return;
            }
            changeOpen(next);
          }}
          onInputValueChange={(next, details) => {
            if (details.reason !== 'input-change' && details.reason !== 'input-clear') {
              details.cancel();
              return;
            }
            queryRef.current = next;
            setQuery(next);
            setHighlighted(undefined);
            changeOpen(true);
            onQueryChange?.(next);
            void runSearch(next);
            if (viewport.current) viewport.current.scrollTop = 0;
          }}
        >
          <Primitive.Input
            ref={input}
            id={`${uid}-input`}
            aria-labelledby={accessibleLabel}
            aria-describedby={ariaDescribedby}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={activeId}
            aria-invalid={invalid || undefined}
            aria-busy={busy}
            placeholder={open ? searchPlaceholder : placeholder}
            data-size={resolvedSize}
            onFocus={() => {
              if (!suppressFocusOpen.current) changeOpen(true);
            }}
            onClick={() => changeOpen(true)}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing) {
                event.preventBaseUIHandler();
                return;
              }
              if (searchFailed && event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                event.preventBaseUIHandler();
                retry.current?.focus();
              } else if (event.key === 'Tab' && open) {
                event.preventBaseUIHandler();
                changeOpen(false);
              } else navigate(event);
            }}
            className={cn(
              'type-caption text-foreground placeholder:text-muted-foreground w-full min-w-0 rounded-(--radius-medium) border px-3',
              textEntryControlClasses,
              'focus-visible:outline-solid focus-visible:-outline-offset-2',
              textEntryHeight(resolvedSize),
              invalid && 'border-danger ring-1 ring-danger/25',
              inputClass,
            )}
          />
          {staticPosition ? (
            open && (
              <div
                ref={scopeRef}
                data-combobox-owner={uid}
                data-static-position
                data-surface-level={surface}
                data-state="open"
                className={cn(
                  menuOverlay(),
                  'w-full max-h-72 rounded-(--radius-medium)',
                  contentClass,
                )}
              >
                {body}
              </div>
            )
          ) : open ? (
            // Base UI requires Portal context even when the popup stays inside this control.
            <Primitive.Portal
              container={portal ? (dialogPortalTarget ?? undefined) : inlinePortalTarget}
            >
              {popup}
            </Primitive.Portal>
          ) : null}
        </Primitive.Root>
      </div>
    </SurfaceProvider>
  );
}

export default Combobox;

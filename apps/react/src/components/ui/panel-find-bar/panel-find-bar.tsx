// Source: src/lib/components/ui/panel-find-bar/PanelFindBar.svelte.
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CaretDown, CaretUp, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { formatNumber } from '$lib/i18n/format';
import type { PanelFindBarProps } from './types';

export function PanelFindBar({
  query: controlledQuery,
  ref,
  inputRef,
  placeholder = m.ui_panelFindBar_find_placeholder(),
  disabled = false,
  inputDisabled = false,
  navigationDisabled = false,
  closeDisabled = false,
  disableNavigationWhenNoMatches = true,
  autofocus = false,
  selectOnFocus = true,
  focusTrigger,
  currentMatchIndex = 0,
  totalMatches,
  resultText,
  emptyResultText = m.ui_panelFindBar_noMatches_label(),
  showResultText = true,
  showResultWhenQueryEmpty = false,
  resultFormat = 'slash',
  resultVariant,
  searchAriaLabel = m.ui_panelFindBar_search_ariaLabel(),
  previousLabel = m.ui_panelFindBar_previous_label(),
  previousShortcutLabel = 'Shift+Enter',
  previousKeyShortcuts = 'Shift+Enter',
  previousTitle,
  nextLabel = m.ui_panelFindBar_next_label(),
  nextShortcutLabel = 'Enter',
  nextKeyShortcuts = 'Enter',
  nextTitle,
  closeLabel = m.ui_panelFindBar_close_label(),
  closeShortcutLabel = 'Esc',
  closeKeyShortcuts = 'Escape',
  closeTitle,
  layout = 'floating',
  className,
  inputWrapperClass,
  inputClass,
  actionsClass,
  onPrevious,
  onNext,
  onClose,
  onQueryChange,
  onInput,
  onKeydown,
  onCompositionStart,
  onCompositionEnd,
}: PanelFindBarProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const hasQuery = query.trim().length > 0;
  const navigationIsDisabled =
    disabled ||
    navigationDisabled ||
    !hasQuery ||
    (disableNavigationWhenNoMatches && typeof totalMatches === 'number' && totalMatches <= 0);
  let resultLabel: string | null = null;
  if (resultText !== undefined) resultLabel = resultText;
  else if (
    showResultText &&
    (hasQuery || showResultWhenQueryEmpty) &&
    typeof totalMatches === 'number'
  ) {
    const displayIndex = Math.min(Math.max(currentMatchIndex + 1, 1), totalMatches);
    resultLabel =
      totalMatches <= 0
        ? hasQuery
          ? emptyResultText
          : null
        : resultFormat === 'of'
          ? m.ui_panelFindBar_matchOf_label({ current: displayIndex, total: totalMatches })
          : `${formatNumber(displayIndex)} / ${formatNumber(totalMatches)}`;
  }
  const effectiveVariant =
    resultVariant ??
    (typeof totalMatches === 'number' && totalMatches <= 0 && hasQuery ? 'destructive' : 'muted');
  useImperativeHandle(inputRef, () => input.current!, []);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
      select: () => input.current?.select(),
    }),
    [],
  );
  useEffect(() => {
    if ((autofocus || focusTrigger !== undefined) && !disabled && !inputDisabled) {
      input.current?.focus();
      if (selectOnFocus) input.current?.select();
    }
  }, [autofocus, focusTrigger, disabled, inputDisabled, selectOnFocus]);
  const titleWithShortcut = (label: string, shortcut?: string) =>
    shortcut ? `${label} (${shortcut})` : label;
  return (
    <search
      aria-label={searchAriaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/90',
        layout === 'floating' && 'absolute top-2 right-4 z-50',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2',
          inputWrapperClass,
        )}
      >
        <MagnifyingGlass aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <Input
          ref={input}
          value={query}
          type="text"
          placeholder={placeholder}
          disabled={disabled || inputDisabled}
          noFocusStyle
          className={cn(
            'h-6 w-36 border-0 bg-transparent px-0 py-0 text-sm shadow-none placeholder:text-muted-foreground',
            inputClass,
          )}
          aria-label={searchAriaLabel}
          onChange={() => {}}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setInternalQuery(value);
            onQueryChange?.(value, event);
            onInput?.(event);
          }}
          onCompositionStart={(event) => {
            composing.current = true;
            onCompositionStart?.(event);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            onCompositionEnd?.(event);
          }}
          onKeyDown={(event) => {
            onKeydown?.(event);
            if (event.defaultPrevented || composing.current || event.nativeEvent.isComposing)
              return;
            if (event.key === 'Escape' && onClose && !closeDisabled && !disabled) {
              event.preventDefault();
              onClose(event);
            } else if (event.key === 'Enter' && !navigationIsDisabled) {
              event.preventDefault();
              (event.shiftKey ? onPrevious : onNext)?.(query, event);
            }
          }}
        />
        {resultLabel && (
          <span
            className={cn(
              'whitespace-nowrap text-xs tabular-nums',
              effectiveVariant === 'destructive' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {resultLabel}
          </span>
        )}
      </div>
      <div className={cn('flex items-center gap-0.5', actionsClass)}>
        <Button
          type="button"
          variant="ghost-light"
          size="icon-xs"
          className="rounded-sm"
          onClick={(event) => onPrevious?.(query, event)}
          disabled={navigationIsDisabled}
          aria-label={previousLabel}
          aria-keyshortcuts={previousKeyShortcuts}
          title={previousTitle ?? titleWithShortcut(previousLabel, previousShortcutLabel)}
        >
          <CaretUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost-light"
          size="icon-xs"
          className="rounded-sm"
          onClick={(event) => onNext?.(query, event)}
          disabled={navigationIsDisabled}
          aria-label={nextLabel}
          aria-keyshortcuts={nextKeyShortcuts}
          title={nextTitle ?? titleWithShortcut(nextLabel, nextShortcutLabel)}
        >
          <CaretDown aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost-light"
          size="icon-xs"
          className="rounded-sm"
          onClick={(event) => onClose?.(event)}
          disabled={disabled || closeDisabled}
          aria-label={closeLabel}
          aria-keyshortcuts={closeKeyShortcuts}
          title={closeTitle ?? titleWithShortcut(closeLabel, closeShortcutLabel)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </search>
  );
}
export default PanelFindBar;

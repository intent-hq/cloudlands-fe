<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown, faChevronUp, faSearch, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { cn } from '$lib/utils';
  import type { PanelFindBarProps } from './types';

  let {
    query = $bindable(''),
    inputRef = $bindable<HTMLInputElement | null>(null),
    placeholder = 'Find...',
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
    resultText = undefined,
    emptyResultText = 'No matches',
    showResultText = true,
    showResultWhenQueryEmpty = false,
    resultFormat = 'slash',
    resultVariant = undefined,
    searchAriaLabel = 'Find in panel',
    previousLabel = 'Previous match',
    previousShortcutLabel = 'Shift+Enter',
    previousKeyShortcuts = 'Shift+Enter',
    previousTitle = undefined,
    nextLabel = 'Next match',
    nextShortcutLabel = 'Enter',
    nextKeyShortcuts = 'Enter',
    nextTitle = undefined,
    closeLabel = 'Close find',
    closeShortcutLabel = 'Esc',
    closeKeyShortcuts = 'Escape',
    closeTitle = undefined,
    layout = 'floating',
    class: className,
    inputWrapperClass,
    inputClass,
    actionsClass,
    onPrevious,
    onNext,
    onClose,
    onQueryChange,
    onInput,
    onKeydown,
  }: PanelFindBarProps = $props();

  const hasQuery = $derived(query.trim().length > 0);
  const navigationIsDisabled = $derived(
    disabled ||
      navigationDisabled ||
      !hasQuery ||
      (disableNavigationWhenNoMatches && typeof totalMatches === 'number' && totalMatches <= 0),
  );
  const resultLabel = $derived.by(() => {
    if (resultText !== undefined) return resultText;
    if (!showResultText) return null;
    if (!hasQuery && !showResultWhenQueryEmpty) return null;
    if (typeof totalMatches !== 'number') return null;
    if (totalMatches <= 0) return hasQuery ? emptyResultText : null;

    const displayIndex = Math.min(Math.max(currentMatchIndex + 1, 1), totalMatches);
    return resultFormat === 'of'
      ? `${displayIndex} of ${totalMatches}`
      : `${displayIndex} / ${totalMatches}`;
  });
  const effectiveResultVariant = $derived(
    resultVariant ??
      (typeof totalMatches === 'number' && totalMatches <= 0 && hasQuery ? 'destructive' : 'muted'),
  );

  $effect(() => {
    if ((autofocus || focusTrigger !== undefined) && inputRef && !disabled && !inputDisabled) {
      inputRef.focus();
      if (selectOnFocus) inputRef.select();
    }
  });

  export function focus() {
    inputRef?.focus();
  }

  export function blur() {
    inputRef?.blur();
  }

  export function select() {
    inputRef?.select();
  }

  function titleWithShortcut(label: string, shortcut?: string) {
    return shortcut ? `${label} (${shortcut})` : label;
  }

  function handleInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    onQueryChange?.(query, event);
    onInput?.(event);
  }

  function handleKeydown(event: KeyboardEvent) {
    onKeydown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Escape' && onClose && !closeDisabled && !disabled) {
      event.preventDefault();
      onClose(event);
    } else if (event.key === 'Enter' && !navigationIsDisabled) {
      event.preventDefault();
      if (event.shiftKey) {
        onPrevious?.(query, event);
      } else {
        onNext?.(query, event);
      }
    }
  }
</script>

<div
  role="search"
  aria-label={searchAriaLabel}
  class={cn(
    'inline-flex items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/90',
    layout === 'floating' && 'absolute top-2 right-4 z-50',
    disabled && 'pointer-events-none opacity-60',
    className,
  )}
>
  <div
    class={cn(
      'flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2',
      inputWrapperClass,
    )}
  >
    <Fa icon={faSearch} class="size-3 shrink-0 text-muted-foreground" />
    <Input
      bind:ref={inputRef}
      bind:value={query}
      type="text"
      {placeholder}
      disabled={disabled || inputDisabled}
      noFocusStyle
      class={cn(
        'h-6 w-36 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
        'placeholder:text-muted-foreground/60',
        inputClass,
      )}
      aria-label={searchAriaLabel}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    {#if resultLabel}
      <span
        class={cn(
          'whitespace-nowrap text-xs tabular-nums',
          effectiveResultVariant === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {resultLabel}
      </span>
    {/if}
  </div>

  <div class={cn('flex items-center gap-0.5', actionsClass)}>
    <Button
      type="button"
      variant="ghost-light"
      size="icon-xs"
      class="rounded-sm"
      onclick={(event) => onPrevious?.(query, event)}
      disabled={navigationIsDisabled}
      aria-label={previousLabel}
      aria-keyshortcuts={previousKeyShortcuts}
      title={previousTitle ?? titleWithShortcut(previousLabel, previousShortcutLabel)}
    >
      <Fa icon={faChevronUp} class="size-3" />
    </Button>
    <Button
      type="button"
      variant="ghost-light"
      size="icon-xs"
      class="rounded-sm"
      onclick={(event) => onNext?.(query, event)}
      disabled={navigationIsDisabled}
      aria-label={nextLabel}
      aria-keyshortcuts={nextKeyShortcuts}
      title={nextTitle ?? titleWithShortcut(nextLabel, nextShortcutLabel)}
    >
      <Fa icon={faChevronDown} class="size-3" />
    </Button>
    <Button
      type="button"
      variant="ghost-light"
      size="icon-xs"
      class="rounded-sm"
      onclick={(event) => onClose?.(event)}
      disabled={disabled || closeDisabled}
      aria-label={closeLabel}
      aria-keyshortcuts={closeKeyShortcuts}
      title={closeTitle ?? titleWithShortcut(closeLabel, closeShortcutLabel)}
    >
      <Fa icon={faXmark} class="size-3.5" />
    </Button>
  </div>
</div>
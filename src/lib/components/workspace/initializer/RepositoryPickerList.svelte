<script lang="ts" generics="T">
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import RepositoryPickerRow from './RepositoryPickerRow.svelte';

  const defaultId = $props.id();
  let {
    id = defaultId,
    items,
    getKey,
    getOwner,
    getName,
    getAvatarUrl,
    provider,
    label,
    loading = false,
    loadingLabel,
    emptyLabel,
    error,
    detail,
    retryLabel,
    onRetry,
    onSelect,
    selectedKey,
    activeIndex = $bindable(-1),
  }: {
    id?: string;
    items: readonly T[];
    getKey: (item: T) => string;
    getOwner: (item: T) => string;
    getName: (item: T) => string;
    getAvatarUrl?: (item: T) => string | undefined;
    provider: 'github' | 'gitlab';
    label: string;
    loading?: boolean;
    loadingLabel: string;
    emptyLabel: string;
    error?: string;
    detail?: string;
    retryLabel?: string;
    onRetry?: () => void;
    onSelect: (item: T) => void;
    selectedKey?: string;
    activeIndex?: number;
  } = $props();

  let list: HTMLDivElement | undefined = $state();
  let typeahead = '';
  let typeaheadAt = 0;

  $effect(() => {
    if (activeIndex >= items.length) activeIndex = -1;
  });

  function focusIndex(index: number) {
    activeIndex = Math.max(0, Math.min(items.length - 1, index));
    list?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.focus();
  }

  function navigate(event: KeyboardEvent, item: T, index: number) {
    if (event.isComposing) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      focusIndex(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : index + (event.key === 'ArrowDown' ? 1 : -1),
      );
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onSelect(item);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      typeahead = now - typeaheadAt > 500 ? event.key : typeahead + event.key;
      typeaheadAt = now;
      for (let offset = 1; offset <= items.length; offset += 1) {
        const next = (index + offset) % items.length;
        if (
          `${getOwner(items[next])}/${getName(items[next])}`
            .toLowerCase()
            .startsWith(typeahead.toLowerCase())
        ) {
          event.preventDefault();
          focusIndex(next);
          break;
        }
      }
    }
  }
</script>

{#if error}
  <div role="alert" class="mt-2 px-1 text-sm text-subtle">
    <div class="flex items-center gap-2">
      <span>{error}</span>
      {#if onRetry && retryLabel}
        <Button
          variant="ghost"
          type="button"
          class="underline underline-offset-2 cursor-pointer hover:no-underline"
          onclick={onRetry}>{retryLabel}</Button
        >
      {/if}
    </div>
    {#if detail}<p class="mt-1">{detail}</p>{/if}
  </div>
{:else if loading}
  <div
    role="status"
    aria-label={loadingLabel}
    class="mt-2 flex items-center gap-2 px-1 text-sm text-subtle"
  >
    <IntentMarkLoader size={12} /><span>{loadingLabel}</span>
  </div>
{:else if items.length}
  <div
    bind:this={list}
    {id}
    role="listbox"
    aria-label={label}
    class="mt-2 max-h-56 overflow-y-auto"
  >
    {#each items as item, index (getKey(item))}
      <RepositoryPickerRow
        id={`${id}-${index}`}
        option
        aria-label={`${getOwner(item)}/${getName(item)}`}
        tabindex={index === Math.max(0, activeIndex) ? 0 : -1}
        aria-selected={selectedKey ? getKey(item) === selectedKey : index === activeIndex}
        selected={index === activeIndex || getKey(item) === selectedKey}
        owner={getOwner(item)}
        name={getName(item)}
        avatarUrl={getAvatarUrl?.(item)}
        {provider}
        onclick={() => onSelect(item)}
        onmousemove={() => (activeIndex = index)}
        onfocus={() => (activeIndex = index)}
        onkeydown={(event) => navigate(event, item, index)}
      />
    {/each}
  </div>
{:else}
  <p class="mt-2 px-1 text-sm text-subtle">{emptyLabel}</p>
{/if}

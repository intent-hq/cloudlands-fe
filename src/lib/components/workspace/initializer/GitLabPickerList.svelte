<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { FormField } from '$lib/components/patterns/form';
  import { ListView, type ListRowContext } from '$lib/components/patterns/collection';
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import type { GitLabPickerProps } from './gitlab-picker-types';

  let {
    scopeKey,
    instanceBaseUrl,
    query,
    page,
    copy,
    onSearch,
    onMore,
    onRecover,
    selectedKey,
    getKey,
    getText,
    onSelect,
    row,
  }: GitLabPickerProps<T> & {
    selectedKey?: string;
    getKey: (item: T) => string;
    getText: (item: T) => string;
    onSelect: (item: T, scopeKey: string) => void;
    row: Snippet<[ListRowContext<T>]>;
  } = $props();

  let panel: HTMLDivElement | undefined = $state();

  function focusResults(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || event.isComposing) return;
    const first = panel?.querySelector<HTMLElement>('[data-slot="list-view-item"]');
    if (!first) return;
    event.preventDefault();
    event.stopPropagation();
    first.focus();
  }
</script>

<div bind:this={panel} class="min-w-0 space-y-3" data-testid="gitlab-picker-list">
  {#if instanceBaseUrl}
    <p class="break-all type-caption text-muted-foreground" data-testid="gitlab-picker-instance">
      {instanceBaseUrl}
    </p>
  {/if}

  {#if page.status === 'unavailable'}
    <ErrorState
      density="compact"
      retryLabel={onRecover ? page.actionLabel : undefined}
      onRetry={onRecover && page.actionLabel ? () => onRecover?.(scopeKey) : undefined}
    >
      {#snippet message()}
        <span>{page.message}</span>
        {#if page.detail}<span class="mt-1 block">{page.detail}</span>{/if}
      {/snippet}
    </ErrorState>
  {:else}
    <FormField label={copy.searchLabel}>
      {#snippet control(controlProps)}
        <Input
          {...controlProps}
          type="search"
          value={query}
          placeholder={copy.searchPlaceholder}
          oninput={(event) => onSearch(event.currentTarget.value, scopeKey)}
          onkeydown={focusResults}
        />
      {/snippet}
    </FormField>

    {#if page.status === 'loading'}
      <LoadingState label={copy.loadingLabel} density="compact" />
    {:else}
      {#key scopeKey}
        <ListView
          items={page.items}
          {getKey}
          {getText}
          selectable="single"
          selectedKeys={selectedKey ? [selectedKey] : []}
          onActivate={(item) => onSelect(item, scopeKey)}
          ariaLabel={copy.listLabel}
          class="max-h-56"
          {row}
        >
          {#snippet empty()}
            <EmptyState density="compact">
              {#snippet description()}{query ? copy.emptySearchLabel : copy.emptyLabel}{/snippet}
            </EmptyState>
          {/snippet}
        </ListView>
      {/key}

      {#if page.hasMore || page.loadingMore}
        <Button
          type="button"
          variant="ghost"
          class="w-full"
          disabled={page.loadingMore}
          onclick={() => onMore(scopeKey)}
        >
          {page.loadingMore ? copy.loadingMoreLabel : copy.loadMoreLabel}
        </Button>
      {/if}
    {/if}
  {/if}
</div>

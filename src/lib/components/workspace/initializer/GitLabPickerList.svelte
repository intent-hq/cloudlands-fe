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
    prefix,
    instanceBaseUrl,
    query,
    page,
    copy,
    onSearch,
    onSubmit,
    submitLabel,
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
  {#if instanceBaseUrl && !prefix}
    <p class="break-all type-caption text-muted-foreground" data-testid="gitlab-picker-instance">
      {instanceBaseUrl}
    </p>
  {/if}

  {#if page.status === 'unavailable'}
    {#if prefix}<div class="flex items-center rounded-lg bg-sidebar">{@render prefix()}</div>{/if}
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
        <div
          class={prefix
            ? 'flex items-center rounded-lg bg-sidebar focus-within:ring-1 focus-within:ring-ring'
            : undefined}
        >
          {#if prefix}{@render prefix()}{/if}
          <Input
            {...controlProps}
            type="search"
            value={query}
            disabled={!scopeKey}
            placeholder={copy.searchPlaceholder}
            oninput={(event) => onSearch(event.currentTarget.value, scopeKey)}
            onkeydown={focusResults}
            class={prefix
              ? 'min-w-0 bg-sidebar border-none px-1 py-2.5! h-auto text-sm'
              : undefined}
          />
        </div>
      {/snippet}
    </FormField>

    {#if onSubmit && submitLabel}
      <Button
        type="button"
        variant="secondary"
        class="w-full"
        disabled={!query.trim() || page.status === 'loading' || page.loadingMore}
        onclick={() => onSubmit?.(query, scopeKey)}
      >
        {submitLabel}
      </Button>
    {/if}

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

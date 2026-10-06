<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import RepositoryPickerList from './RepositoryPickerList.svelte';
  import type { GitLabProjectPickerProps } from './gitlab-picker-types';

  let {
    selectedProjectPath,
    onSelect,
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
  }: GitLabProjectPickerProps = $props();

  let panel: HTMLDivElement | undefined = $state();
  function focusResults(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || event.isComposing) return;
    const first = panel?.querySelector<HTMLElement>('[role="option"]');
    if (!first) return;
    event.preventDefault();
    event.stopPropagation();
    first.focus();
  }
</script>

<div bind:this={panel} class="min-w-0" data-testid="gitlab-picker-list">
  {#if instanceBaseUrl && !prefix}
    <p class="break-all type-caption text-muted-foreground" data-testid="gitlab-picker-instance">
      {instanceBaseUrl}
    </p>
  {/if}
  <div class="flex items-center rounded-lg bg-sidebar focus-within:ring-1 focus-within:ring-ring">
    {#if prefix}{@render prefix()}{/if}
    {#if page.status !== 'unavailable'}
      <Input
        type="search"
        aria-label={copy.searchLabel}
        value={query}
        disabled={!scopeKey}
        placeholder={copy.searchPlaceholder}
        oninput={(event) => onSearch(event.currentTarget.value, scopeKey)}
        onkeydown={focusResults}
        class="min-w-0 bg-sidebar border-none px-1 py-2.5! h-auto text-sm"
        noFocusStyle
      />
    {/if}
  </div>
  {#if page.status !== 'unavailable' && onSubmit && submitLabel}
    <Button
      type="button"
      variant="secondary"
      class="mt-2 w-full"
      disabled={!query.trim() || page.status === 'loading' || page.loadingMore}
      onclick={() => onSubmit?.(query, scopeKey)}>{submitLabel}</Button
    >
  {/if}
  {#key scopeKey}
    <RepositoryPickerList
      items={page.status === 'ready' ? page.items : []}
      getKey={(project) => project.projectPath}
      getOwner={(project) => project.projectPath.split('/').slice(0, -1).join('/')}
      getName={(project) => project.projectPath.split('/').at(-1) ?? project.name}
      getAvatarUrl={(project) => project.ownerAvatarUrl}
      provider="gitlab"
      label={copy.listLabel}
      loading={page.status === 'loading'}
      loadingLabel={copy.loadingLabel}
      emptyLabel={query ? copy.emptySearchLabel : copy.emptyLabel}
      error={page.status === 'unavailable' ? page.message : undefined}
      detail={page.status === 'unavailable' ? page.detail : undefined}
      retryLabel={page.status === 'unavailable' ? page.actionLabel : undefined}
      onRetry={onRecover ? () => onRecover?.(scopeKey) : undefined}
      selectedKey={selectedProjectPath}
      onSelect={(project) => onSelect(project.projectPath, scopeKey)}
    />
  {/key}
  {#if page.status === 'ready' && (page.hasMore || page.loadingMore)}
    <Button
      type="button"
      variant="ghost"
      class="mt-2 w-full"
      disabled={page.loadingMore}
      onclick={() => onMore(scopeKey)}
    >
      {page.loadingMore ? copy.loadingMoreLabel : copy.loadMoreLabel}
    </Button>
  {/if}
</div>

<script lang="ts">
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectCustomViewById,
    selectCustomViewRuntime,
    selectCustomViewsState,
  } from '../custom-views-selectors';
  import {
    editCustomView,
    reloadCustomViewFrame,
    startCustomView,
    stopCustomView,
  } from '../custom-views-slice';
  import { customViewErrorMessage, customViewStatusLabel } from '../custom-views-labels';
  import { customViewFrameUrl } from '../custom-views-model';
  import CustomViewFrame from './CustomViewFrame.svelte';

  let { viewId, preview = false }: { viewId: string; preview?: boolean } = $props();
  const viewId$ = toStore(() => viewId);
  const view$ = selectCustomViewById(viewId$);
  const runtime$ = selectCustomViewRuntime(viewId$);
  const state$ = selectCustomViewsState();
  const url = $derived($view$ ? customViewFrameUrl($view$, $runtime$) : null);
  const active = $derived($runtime$?.status === 'running' || $runtime$?.status === 'starting');
  const error = $derived($runtime$?.errorCode ?? $state$.error);
</script>

<section
  class="flex h-full min-h-0 min-w-0 flex-col"
  aria-label={$view$?.name ?? m.custom_views_title()}
>
  {#if $view$}
    <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div class="min-w-0 flex-1">
        <h1 class="truncate type-title">{$view$.name}</h1>
        <p role="status" class="type-caption text-muted-foreground">
          {customViewStatusLabel($runtime$?.status ?? 'stopped')}
        </p>
      </div>
      <Button
        variant="ghost-light"
        size="sm"
        disabled={$state$.busy}
        onclick={() => appStore.dispatch(editCustomView(viewId))}>{m.custom_views_edit()}</Button
      >
      {#if url}<Button
          variant="ghost-light"
          size="sm"
          onclick={() => appStore.dispatch(reloadCustomViewFrame(viewId))}>{m.menu_reload()}</Button
        >{/if}
      <Button
        variant="secondary"
        size="sm"
        disabled={preview || $state$.busy}
        onclick={() => appStore.dispatch(active ? stopCustomView(viewId) : startCustomView(viewId))}
        >{active ? m.custom_views_stop() : m.custom_views_start()}</Button
      >
    </header>
    {#if url}
      <p class="shrink-0 px-4 py-2 type-caption text-muted-foreground">
        {m.custom_views_frame_hint()}
      </p>
      {#key viewId + url}<CustomViewFrame {viewId} {url} title={$view$.name} />{/key}
    {:else if error}
      <ErrorState
        >{#snippet message()}{customViewErrorMessage(error ?? 'start-failed')}{/snippet}</ErrorState
      >
    {:else}
      <EmptyState
        >{#snippet description()}{active
            ? m.custom_views_starting_hint()
            : m.custom_views_stopped_hint()}{/snippet}</EmptyState
      >
    {/if}
    {#if $runtime$?.logs}
      <details
        class="max-h-48 shrink-0 overflow-auto border-t border-border px-4 py-2 type-caption text-muted-foreground"
      >
        <summary class="cursor-pointer">{m.custom_views_logs()}</summary>
        <pre class="mt-2 whitespace-pre-wrap break-words font-mono">{$runtime$.logs}</pre>
      </details>
    {/if}
  {:else}
    <EmptyState>{#snippet description()}{m.custom_views_error_missing()}{/snippet}</EmptyState>
  {/if}
</section>

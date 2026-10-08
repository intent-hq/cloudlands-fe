<script lang="ts">
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { ActionBar } from '$lib/components/patterns/action-menu';
  import { ContentDialog, confirm } from '$lib/components/patterns/confirm';
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
    removeCustomView,
    startCustomView,
    stopCustomView,
  } from '../custom-views-slice';
  import { customViewErrorMessage } from '../custom-views-labels';
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
  let logsOpen = $state(false);

  async function remove() {
    const view = $view$;
    if (
      !view ||
      preview ||
      !(await confirm({
        title: m.custom_views_remove_title({ name: view.name }),
        description: m.custom_views_remove_description(),
        confirmLabel: m.custom_views_remove(),
        destructive: true,
      }))
    )
      return;
    appStore.dispatch(removeCustomView(view.id));
  }
</script>

<section
  class="flex h-full min-h-0 min-w-0 flex-col"
  aria-label={$view$?.name ?? m.custom_views_title()}
>
  {#if $view$}
    <header class="flex shrink-0 justify-end border-b border-border px-3 py-1">
      <ActionBar
        visibleCount={0}
        overflowLabel={m.custom_views_actions({ name: $view$.name })}
        actions={[
          { id: 'edit', label: m.custom_views_edit(), disabled: $state$.busy },
          {
            id: 'server',
            label: active ? m.custom_views_stop() : m.custom_views_start(),
            disabled: preview || $state$.busy,
          },
          { id: 'reload', label: m.menu_reload(), disabled: !url },
          { id: 'logs', label: m.custom_views_logs() },
          {
            id: 'remove',
            label: m.custom_views_remove(),
            group: 'remove',
            destructive: true,
            disabled: preview || $state$.busy,
          },
        ]}
        onAction={(id) => {
          if (id === 'edit') appStore.dispatch(editCustomView(viewId));
          else if (id === 'server')
            appStore.dispatch(active ? stopCustomView(viewId) : startCustomView(viewId));
          else if (id === 'reload') appStore.dispatch(reloadCustomViewFrame(viewId));
          else if (id === 'logs') logsOpen = true;
          else if (id === 'remove') void remove();
        }}
      />
    </header>
    {#if url}
      {#key viewId + url}<CustomViewFrame {viewId} {url} title={$view$.name} />{/key}
    {:else if error}
      <ErrorState
        >{#snippet message()}{customViewErrorMessage(error ?? 'start-failed')}{/snippet}</ErrorState
      >
    {:else if $runtime$?.status === 'starting'}
      <div class="flex min-h-0 flex-1 items-center justify-center">
        <IntentMarkLoader />
      </div>
    {/if}
    {#if logsOpen}
      <ContentDialog
        open
        title={m.custom_views_logs()}
        description={$view$.name}
        size="lg"
        onClose={() => (logsOpen = false)}
      >
        {#if $runtime$?.logs}
          <pre class="whitespace-pre-wrap break-words font-mono type-caption">{$runtime$.logs}</pre>
        {:else}
          <p class="type-body text-muted-foreground">{m.chat_toolDetails_noOutput_label()}</p>
        {/if}
        {#snippet footer()}
          <Button variant="ghost" onclick={() => (logsOpen = false)}
            >{m.settings_wsApi_close()}</Button
          >
        {/snippet}
      </ContentDialog>
    {/if}
  {:else}
    <EmptyState>{#snippet description()}{m.custom_views_error_missing()}{/snippet}</EmptyState>
  {/if}
</section>

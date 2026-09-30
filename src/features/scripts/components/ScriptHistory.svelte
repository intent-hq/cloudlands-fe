<script lang="ts">
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import {
    selectScriptManagerEntries,
    selectScriptHistoryState,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    scriptArchiveRequested,
    refreshScripts,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import {
    selectScript,
    openTerminalOverlay,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { store as appStore } from '$store/renderer/store';
  import { historyNeedsAttention } from '../utils/script-history';
  import ScriptHistoryView from './ScriptHistoryView.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();
  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const entries$ = selectScriptManagerEntries(workspaceIdStore);
  const state$ = selectScriptHistoryState(workspaceIdStore);
  let openFor = $state<string | null>(null);
  const attention = $derived($entries$.filter(historyNeedsAttention).length);
</script>

{#if $state$.lifecycleSupported}
  <Button
    variant="ghost"
    size="sm"
    onclick={() => {
      openFor = workspaceId;
      appStore.dispatch(refreshScripts(workspaceId, true));
    }}
  >
    {attention
      ? m.scripts_history_attention_label({ count: attention })
      : m.scripts_history_title()}
  </Button>
  {#if openFor === workspaceId}
    <ContentDialog
      open
      title={m.scripts_history_title()}
      description={m.scripts_history_description()}
      size="lg"
      onClose={() => (openFor = null)}
    >
      {#key workspaceId}
        <ScriptHistoryView
          scripts={$entries$}
          loading={$state$.loading || $state$.historyLoading}
          error={$state$.loadError || $state$.historyError}
          operation={$state$.archiveOperation}
          onRetry={() => appStore.dispatch(refreshScripts(workspaceId, true))}
          onSubmit={(ids, operation) =>
            appStore.dispatch(scriptArchiveRequested(workspaceId, ids, operation))}
          onInspect={(id) => {
            appStore.dispatch(selectScript(workspaceId, id));
            appStore.dispatch(openTerminalOverlay(workspaceId));
            openFor = null;
          }}
        />
      {/key}
    </ContentDialog>
  {/if}
{/if}

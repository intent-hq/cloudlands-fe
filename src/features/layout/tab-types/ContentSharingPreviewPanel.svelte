<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import NoteTabType from './NoteTabType.svelte';
  import AgentTabType from './AgentTabType.svelte';
  import {
    SHARING_AGENT_ID,
    SHARING_NOTE_ID,
    SHARING_WORKSPACE_ID,
  } from './content-sharing.preview-fixtures';

  let { kind }: { kind: 'note' | 'agent' } = $props();
  const header = createPanelHeaderContext();
  const tab = $derived<PanelTab>({
    id: `preview-${kind}-tab`,
    type: kind,
    closable: false,
    title: kind === 'note' ? 'Launch checklist' : 'Review helper',
    noteId: kind === 'note' ? SHARING_NOTE_ID : undefined,
    agentId: kind === 'agent' ? SHARING_AGENT_ID : undefined,
  });
</script>

<section class="sharing-panel" data-sharing-panel={kind} data-panel-id={`preview-${kind}`}>
  <PanelTabBar
    tabs={[tab]}
    activeTabId={tab.id}
    panelId={`preview-${kind}`}
    workspaceId={SHARING_WORKSPACE_ID}
    isFocused
    contentActions={header.actions.current}
  />
  <div class="sharing-body">
    {#if kind === 'note'}
      <NoteTabType {tab} workspaceId={SHARING_WORKSPACE_ID} isActive isPanelFocused />
    {:else}
      <AgentTabType {tab} workspaceId={SHARING_WORKSPACE_ID} isActive isPanelFocused />
    {/if}
  </div>
</section>

<style>
  .sharing-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 490px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
  }
  .sharing-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: inherit;
  }
</style>

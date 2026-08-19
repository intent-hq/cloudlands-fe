<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import WorkspaceAgentsList from '../../WorkspaceAgentsList.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import '../../../../../app.css';

  appStore.init();

  let {
    width = 220,
    zoom = 2,
    virtual = false,
  }: { width?: number; zoom?: number; virtual?: boolean } = $props();

  const workspaceId = WorkspaceId('workspace-agent-row-geometry');
  let selectedAgentId = $state<string | null>('coordinator');
  let searchQuery = $state('');

  function makeAgent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: AgentId(id),
      backendSessionId: `backend-${id}`,
      workspaceId,
      name: id,
      status: AgentStatus.Idle,
      messages: [],
      lastAgentResponse: `preview text for ${id}`,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:01:00.000Z',
      ...overrides,
    } as AgentSession;
  }

  const treeAgents = [
    makeAgent('coordinator', {
      name: 'Coordinator',
      metadata: { specialist: 'spec-writer' } as AgentSession['metadata'],
    }),
    makeAgent('delegated-search-target', {
      name: 'Delegated search target',
      status: AgentStatus.Active,
      metadata: { createdByAgentId: 'coordinator' } as AgentSession['metadata'],
    }),
    makeAgent('long-name', {
      name: 'An extremely long foreground agent name that must ellipsize before all badges',
    }),
    makeAgent('background-active', {
      name: 'Background active',
      isBackground: true,
      status: AgentStatus.Active,
    }),
    makeAgent('background-idle', { name: 'Background idle', isBackground: true }),
  ];
  const virtualAgents = Array.from({ length: 24 }, (_, index) =>
    makeAgent(`virtual-${index}`, { name: `Virtual agent ${index}` }),
  );
  const agents = $derived(virtual ? virtualAgents : treeAgents);
  const longTab: PanelTab = {
    id: 'long-tab',
    type: 'agent',
    title: 'Long agent',
    closable: true,
    workspaceId,
    agentId: 'long-name',
  };
  const backgroundTab: PanelTab = {
    id: 'background-tab',
    type: 'agent',
    title: 'Background agent',
    closable: true,
    workspaceId,
    agentId: 'background-active',
  };

  onMount(() => {
    appStore.dispatch(bulkUpsertSessions(agents));
  });
  onDestroy(() => {
    for (const agent of agents) appStore.dispatch(removeSession(agent.id));
  });
</script>

<section style:width={`${width}px`} style:zoom data-agent-list-geometry-harness>
  {#if !virtual}
    <input aria-label="Search agents" bind:value={searchQuery} data-agent-search />
  {/if}
  <div data-selected-agent={selectedAgentId ?? ''}></div>
  <WorkspaceAgentsList
    {agents}
    {searchQuery}
    {workspaceId}
    {selectedAgentId}
    runningAgentIds={virtual ? [] : ['delegated-search-target', 'background-active']}
    openPanelTabs={virtual ? [] : [longTab, backgroundTab]}
    activePanelTab={virtual ? null : longTab}
    onSelect={({ agentId }) => (selectedAgentId = agentId)}
  />
</section>

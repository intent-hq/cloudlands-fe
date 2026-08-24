<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import { AgentStatus } from '$shared/types/agent.types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    theme = 'light',
    width = 280,
    zoom = 1,
    activeAgent = 'a',
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    activeAgent?: 'a' | 'b';
  } = $props();

  const workspaceId = WorkspaceId('panel-avatar-workspace');
  const agentA = AgentId('panel-avatar-agent-a');
  const agentB = AgentId('panel-avatar-agent-b');
  const timestamp = '2026-08-16T01:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  $effect(() => {
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains('dark');
    root.classList.toggle('dark', theme === 'dark');
    return () => root.classList.toggle('dark', hadDarkClass);
  });

  function session(id: typeof agentA, name: string): AgentSession {
    return {
      id,
      backendSessionId: null,
      workspaceId,
      name,
      status: AgentStatus.RuntimeIdle,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  store.dispatch(bulkUpsertSessions([session(agentA, 'Agent A'), session(agentB, 'Agent B')]));
  const activeTabId = $derived(activeAgent === 'b' ? 'tab-b' : 'tab-a');
  const allTabs = [
    { id: 'tab-a', type: 'agent' as const, title: 'Agent A', agentId: agentA, closable: true },
    { id: 'tab-b', type: 'agent' as const, title: 'Agent B', agentId: agentB, closable: true },
  ];
  const tabs = $derived(activeAgent === 'b' ? [allTabs[1]] : [allTabs[0]]);
</script>

<section
  class="overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="panel-avatar-host"
  data-theme={theme}
  data-active-agent={activeTabId === 'tab-b' ? agentB : agentA}
>
  <PanelTabBar {tabs} {activeTabId} panelId="panel-avatar" {workspaceId} isFocused />
</section>

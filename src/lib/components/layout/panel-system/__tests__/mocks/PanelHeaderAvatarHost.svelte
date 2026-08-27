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
    focused = true,
    attention = false,
    longTitle = false,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    activeAgent?: 'a' | 'b';
    focused?: boolean;
    attention?: boolean;
    longTitle?: boolean;
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

  const agentName = $derived(
    longTitle ? 'Agent with a deliberately long panel header title' : 'Agent',
  );
  const noteTitle = $derived(
    longTitle ? 'Note with a deliberately long panel header title' : 'Note',
  );
  $effect(() => {
    store.dispatch(
      bulkUpsertSessions([session(agentA, `${agentName} A`), session(agentB, `${agentName} B`)]),
    );
  });
  const activeTabId = $derived(activeAgent === 'b' ? 'tab-b' : 'tab-a');
  const allTabs = $derived([
    {
      id: 'tab-a',
      type: 'agent' as const,
      title: `${agentName} A`,
      agentId: agentA,
      closable: true,
    },
    {
      id: 'tab-b',
      type: 'agent' as const,
      title: `${agentName} B`,
      agentId: agentB,
      closable: true,
    },
  ]);
  const tabs = $derived(activeAgent === 'b' ? [allTabs[1]] : [allTabs[0]]);
  const noteTab = $derived({
    id: 'tab-note',
    type: 'note' as const,
    title: noteTitle,
    noteId: 'panel-avatar-note',
    closable: true,
  });
</script>

<section
  class="overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="panel-avatar-host"
  data-theme={theme}
  data-active-agent={activeTabId === 'tab-b' ? agentB : agentA}
>
  <div data-panel-header-case="agent">
    <PanelTabBar
      {tabs}
      {activeTabId}
      panelId="panel-avatar-agent"
      {workspaceId}
      isFocused={focused}
      attentionTabIds={attention ? [activeTabId] : []}
    />
  </div>
  <div data-panel-header-case="resource">
    <PanelTabBar
      tabs={[noteTab]}
      activeTabId={noteTab.id}
      panelId="panel-avatar-resource"
      {workspaceId}
      isFocused={focused}
      attentionTabIds={attention ? [noteTab.id] : []}
    />
  </div>
</section>

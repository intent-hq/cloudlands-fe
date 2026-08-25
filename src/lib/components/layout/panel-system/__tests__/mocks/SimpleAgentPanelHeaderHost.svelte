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
    activeAgent = 'root',
    stackCount = 1,
    width = 560,
    theme = 'light',
  }: {
    activeAgent?: 'root' | 'delegated';
    stackCount?: 1 | 2;
    width?: number;
    theme?: 'light' | 'dark';
  } = $props();

  const workspaceId = WorkspaceId('simple-agent-header-workspace');
  const rootAgentId = AgentId('simple-agent-header-root');
  const delegatedAgentId = AgentId('simple-agent-header-delegated');
  const timestamp = '2026-08-24T00:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  let rootName = $state('Root coordinator with a deliberately long current agent name');
  let delegatedName = $state('Layout verifier with a deliberately long current agent name');
  let lastRename = $state('');

  function session(id: typeof rootAgentId, name: string, delegated = false): AgentSession {
    return {
      id,
      backendSessionId: null,
      workspaceId,
      name,
      status: AgentStatus.RuntimeIdle,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: delegated ? { createdByAgentId: rootAgentId, specialist: 'verifier' } : undefined,
    };
  }

  function syncSessions() {
    store.dispatch(
      bulkUpsertSessions([
        session(rootAgentId, rootName),
        session(delegatedAgentId, delegatedName, true),
      ]),
    );
  }

  syncSessions();
  onDestroy(disposeStore);

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });

  const allTabs = $derived([
    {
      id: 'root-tab',
      type: 'agent' as const,
      title: rootName,
      agentId: rootAgentId,
      closable: true,
    },
    {
      id: 'delegated-tab',
      type: 'agent' as const,
      title: delegatedName,
      agentId: delegatedAgentId,
      closable: true,
    },
  ]);
  const activeTabId = $derived(activeAgent === 'root' ? 'root-tab' : 'delegated-tab');
  const tabs = $derived(
    stackCount === 2 ? allTabs : allTabs.filter((tab) => tab.id === activeTabId),
  );

  function renameAgent(tabId: string, name: string) {
    lastRename = `${tabId}:${name}`;
    if (tabId === 'root-tab') rootName = name;
    else delegatedName = name;
    syncSessions();
  }
</script>

<section
  class="overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  data-testid="simple-agent-panel-header-host"
  data-last-rename={lastRename}
>
  <PanelTabBar
    {tabs}
    {activeTabId}
    panelId="simple-agent-header-panel"
    {workspaceId}
    isFocused
    onTabRename={(tab, name) => renameAgent(tab.id, name)}
    onTabClose={() => {}}
    onClosePanel={() => {}}
  />
</section>

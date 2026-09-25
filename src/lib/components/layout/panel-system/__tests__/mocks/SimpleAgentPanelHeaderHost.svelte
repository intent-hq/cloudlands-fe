<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import { AgentStatus } from '$shared/types/agent.types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import TaskProgressControl from '$lib/components/chat/TaskProgressControl.svelte';
  import BrowserTabsMenu from '$lib/components/chat/BrowserTabsMenu.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    activeAgent = 'root',
    stackCount = 1,
    width = 560,
    theme = 'light',
    fullActions = false,
  }: {
    activeAgent?: 'root' | 'delegated';
    stackCount?: 1 | 2;
    width?: number;
    theme?: 'light' | 'dark';
    fullActions?: boolean;
  } = $props();

  const workspaceId = WorkspaceId('simple-agent-header-workspace');
  const rootAgentId = AgentId('simple-agent-header-root');
  const delegatedAgentId = AgentId('simple-agent-header-delegated');
  const panelId = 'simple-agent-header-panel';
  const columnCount$ = selectPanelColumnCount(workspaceId);
  const timestamp = '2026-08-24T00:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  let rootName = $state('Root coordinator with a deliberately long current agent name');
  let delegatedName = $state('Layout verifier with a deliberately long current agent name');
  let lastRename = $state('');
  let renameCount = $state(0);
  let closeCount = $state(0);
  let zoomCount = $state(0);
  let selectedMessage = $state('');
  let atBottom = $state(false);

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

  onMount(() => {
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId },
        panels: { [panelId]: { id: panelId, tabs, activeTabId } },
        focusedPanelId: panelId,
        columnCount: 1,
      }),
    );
    return () => store.dispatch(clearPanelLayout(workspaceId));
  });

  function renameAgent(tabId: string, name: string) {
    lastRename = `${tabId}:${name}`;
    renameCount += 1;
    if (tabId === 'root-tab') rootName = name;
    else delegatedName = name;
    syncSessions();
  }
</script>

{#snippet primaryActions()}
  <div class="flex min-w-0 items-center gap-0.5">
    <TaskProgressControl
      tasks={[{ id: 'review', status: 'review_required', title: 'Review the header' }]}
      presentation="checklist"
    />
    <BrowserTabsMenu
      {workspaceId}
      agentId={rootAgentId}
      entries={[
        {
          tab: {
            id: 'header-browser',
            type: 'browser',
            title: 'Header preview',
            ownerAgentId: rootAgentId,
            closable: true,
          },
          panelId,
          active: true,
          hidden: false,
        },
      ]}
    />
    <ChatMessageNavigator
      messages={[
        { id: 'first', text: 'Review header layout' },
        { id: 'last', text: 'Keep actions usable' },
      ]}
      isAtBottom={atBottom}
      onSelectMessage={(id) => {
        selectedMessage = id;
        return true;
      }}
      onScrollToBottom={() => (atBottom = true)}
    />
  </div>
{/snippet}

<section
  class="flex flex-col bg-background text-foreground"
  style:width={`${width}px`}
  style:height="400px"
  style:container-type="size"
  data-testid="simple-agent-panel-header-host"
  data-panel-id={panelId}
  data-last-rename={lastRename}
  data-rename-count={renameCount}
  data-close-count={closeCount}
  data-zoom-count={zoomCount}
  data-column-count={$columnCount$}
  data-selected-message={selectedMessage}
>
  <PanelTabBar
    {tabs}
    {activeTabId}
    {panelId}
    {workspaceId}
    isFocused
    onTabRename={(tab, name) => renameAgent(tab.id, name)}
    contentActions={fullActions ? { primary: primaryActions } : undefined}
    onTabClick={(id) => (activeAgent = id === 'root-tab' ? 'root' : 'delegated')}
    onZoomToggle={() => (zoomCount += 1)}
    onTabClose={() => (closeCount += 1)}
    onClosePanel={() => {}}
  />
  <div class="min-h-0 flex-1" data-testid="header-adjacent-content"></div>
</section>

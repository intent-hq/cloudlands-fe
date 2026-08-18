<script lang="ts">
  import { onDestroy } from 'svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import type { AgentSession } from '$shared/types';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { setBundledSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    clearPanelLayout,
    closeTab,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    theme = 'light',
    width = 280,
    height = 320,
    zoom = 1,
    historyCount = 8,
    closedHistoryCount = 0,
    initialActiveTabId = 'note-history',
    pinned = true,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    height?: number;
    zoom?: number;
    historyCount?: number;
    closedHistoryCount?: number;
    initialActiveTabId?: string;
    pinned?: boolean;
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  registerAllTabTypes();
  const workspaceId = 'panel-history-workspace';
  const timestamp = '2026-08-17T00:00:00.000Z';
  const agents = [
    {
      id: 'coordinator-history',
      workspaceId,
      name: 'Coordinator',
      status: 'idle',
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'agent-history',
      workspaceId,
      name: 'Build agent',
      status: 'idle',
      messages: [],
      metadata: { specialist: 'implementor', createdByAgentId: 'coordinator-history' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] as unknown as AgentSession[];
  store.dispatch(bulkUpsertSessions(agents, { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, agents));
  store.dispatch(
    setBundledSpecialists([
      {
        id: 'implementor',
        name: 'Implementor',
        description: 'Builds focused implementation changes.',
        defaultBehaviorPrompt: '',
      },
    ]),
  );

  const allTabs: PanelTab[] = [
    {
      id: 'agent-history',
      type: 'agent',
      title: 'Build agent',
      agentId: 'agent-history',
      closable: true,
    },
    {
      id: 'note-history',
      type: 'note',
      title: 'Release plan',
      noteId: 'note-history',
      closable: true,
    },
    {
      id: 'file-history',
      type: 'file',
      title: 'panel.ts',
      filePath: '/workspace/src/panel.ts',
      closable: true,
    },
    {
      id: 'browser-history',
      type: 'browser',
      title: 'Preview',
      browserUrl: 'https://example.com/preview',
      closable: true,
    },
    {
      id: 'terminal-history',
      type: 'terminal',
      title: 'Development server',
      terminalId: 'terminal-history',
      closable: true,
    },
    { id: 'changes-history', type: 'changes', title: 'Changes', closable: true },
    { id: 'settings-history', type: 'settings', title: 'Settings', closable: true },
    { id: 'fallback-history', type: 'overview', title: 'Overview', closable: true },
    {
      id: 'agents-file-history',
      type: 'file',
      title: 'AGENTS.md',
      filePath: 'AGENTS.md',
      closable: true,
    },
  ];
  const tabs = $derived(allTabs.slice(0, historyCount));
  let activeTabId = $state(initialActiveTabId);

  store.dispatch(clearPanelLayout(workspaceId));
  if (closedHistoryCount > 0) {
    const closedTabs = allTabs.slice(historyCount, historyCount + closedHistoryCount);
    const seededTabs = [...allTabs.slice(0, historyCount), ...closedTabs];
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'panel-history' },
        panels: {
          'panel-history': {
            id: 'panel-history',
            tabs: seededTabs,
            activeTabId: initialActiveTabId,
          },
        },
        focusedPanelId: 'panel-history',
      }),
    );
    closedTabs.forEach((tab, index) => {
      store.dispatch(closeTab(workspaceId, tab.id, 'panel-history', index + 1));
    });
  }

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id ?? '';
  });

  onDestroy(() => {
    document.documentElement.classList.remove('dark');
    store.dispatch(clearPanelLayout(workspaceId));
    disposeStore();
  });
</script>

<section
  class="overflow-hidden bg-background text-foreground"
  style={`width: ${width}px; height: ${height}px; zoom: ${zoom}; container-type: size;`}
  data-testid="panel-identity-history-host"
  data-active-tab={activeTabId}
>
  <PanelTabBar
    {tabs}
    {activeTabId}
    panelId="panel-history"
    {workspaceId}
    isFocused
    onTabClick={(tabId) => (activeTabId = tabId)}
    onTabRename={() => {}}
    onClosePanel={() => {}}
  />
  <button type="button" data-testid="outside-control">Outside</button>
</section>

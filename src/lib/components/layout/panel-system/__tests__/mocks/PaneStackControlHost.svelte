<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    theme = 'light',
    width = 320,
    height = 320,
    zoom = 1,
    stackCount = 5,
    initialActiveTabId = 'note-pane',
    attentionTabIds = [],
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    height?: number;
    zoom?: number;
    stackCount?: number;
    initialActiveTabId?: string;
    attentionTabIds?: string[];
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  const allTabs: PanelTab[] = [
    {
      id: 'agent-pane',
      type: 'agent',
      title: 'Build agent',
      agentId: 'agent-pane',
      closable: true,
    },
    {
      id: 'note-pane',
      type: 'note',
      title: 'Release plan',
      noteId: 'note-pane',
      closable: true,
    },
    {
      id: 'file-pane',
      type: 'file',
      title: 'panel.ts',
      filePath: '/workspace/src/panel.ts',
      closable: true,
    },
    {
      id: 'browser-pane',
      type: 'browser',
      title: 'Preview browser',
      browserUrl: 'https://example.com/preview',
      closable: true,
    },
    {
      id: 'terminal-pane',
      type: 'terminal',
      title: 'Development server',
      terminalId: 'terminal-pane',
      closable: true,
    },
  ];
  const tabs = $derived(allTabs.slice(0, stackCount));
  // svelte-ignore state_referenced_locally - the prop seeds the test harness state
  let activeTabId = $state(initialActiveTabId);
  let lastClosedTabId = $state('');
  let closePanelCount = $state(0);

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id ?? '';
  });

  onDestroy(() => {
    document.documentElement.classList.remove('dark');
    disposeStore();
  });
</script>

<section
  class="overflow-hidden bg-background text-foreground"
  style={`width: ${width}px; height: ${height}px; zoom: ${zoom}; container-type: size;`}
  data-testid="pane-stack-control-host"
  data-active-tab={activeTabId}
  data-last-closed-tab={lastClosedTabId}
  data-close-panel-count={closePanelCount}
>
  <PanelTabBar
    {tabs}
    {activeTabId}
    {attentionTabIds}
    panelId="pane-stack-panel"
    workspaceId="pane-stack-workspace"
    isRightmostPanel
    isFocused
    onTabClick={(tabId) => (activeTabId = tabId)}
    onTabClose={(tabId) => (lastClosedTabId = tabId)}
    onClosePanel={() => (closePanelCount += 1)}
  />
</section>

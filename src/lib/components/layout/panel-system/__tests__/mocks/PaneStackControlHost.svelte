<script lang="ts">
  import { onDestroy } from 'svelte';
  import type {
    PanelTab,
    PanelTabType,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import PanelTabBar from '../../PanelTabBar.svelte';

  type PaneFixtureType = PanelTabType | 'task';

  let {
    theme = 'light',
    width = 320,
    height = 320,
    zoom = 1,
    stackCount = 5,
    initialActiveTabId = 'note-pane',
    attentionTabIds = [],
    paneTypes = ['agent', 'note', 'file', 'browser', 'terminal'],
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    height?: number;
    zoom?: number;
    stackCount?: number;
    initialActiveTabId?: string;
    attentionTabIds?: string[];
    paneTypes?: PaneFixtureType[];
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  const paneTitles: Record<PaneFixtureType, string> = {
    note: 'Release plan',
    file: 'panel.ts',
    diff: 'Panel changes',
    changes: 'Changes',
    'local-changes': 'Local changes',
    'chat-changes': 'Chat changes',
    agent: 'Build agent',
    terminal: 'Development server',
    settings: 'Settings',
    overview: 'Overview',
    browser: 'Preview browser',
    'hook-script': 'Hook script',
    activity: 'Activity',
    'activity-changes': 'Activity changes',
    'code-review': 'Code review',
    'agent-overview': 'Agent overview',
    map: 'Map',
    task: 'Assigned task',
  };

  function createTab(fixtureType: PaneFixtureType): PanelTab {
    const id = `${fixtureType}-pane`;
    const type = fixtureType === 'task' ? 'note' : fixtureType;
    return {
      id,
      type,
      title: paneTitles[fixtureType],
      agentId: type === 'agent' ? id : undefined,
      noteId: type === 'note' ? id : undefined,
      filePath: type === 'file' ? '/workspace/src/panel.ts' : undefined,
      browserUrl: type === 'browser' ? 'https://example.com/preview' : undefined,
      terminalId: type === 'terminal' ? id : undefined,
      closable: true,
    };
  }

  const tabs = $derived(paneTypes.slice(0, stackCount).map(createTab));
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

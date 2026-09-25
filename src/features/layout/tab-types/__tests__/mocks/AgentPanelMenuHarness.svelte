<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import AgentTabType from '../../AgentTabType.svelte';

  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const workspaceId = 'agent-panel-menu-ct';
  const tab: PanelTab = {
    id: 'agent-menu-tab',
    type: 'agent',
    title: 'Menu acceptance agent',
    agentId: 'agent-menu-ct',
    closable: true,
  };
  const header = createPanelHeaderContext();
  onDestroy(dispose);
</script>

<!-- Real production snippets; no workspace record means no chat/backend lifecycle. -->
<section class="w-full overflow-hidden bg-background text-foreground">
  <PanelTabBar
    tabs={[tab]}
    activeTabId={tab.id}
    panelId="agent-menu-panel"
    {workspaceId}
    isFocused
    contentActions={header.actions.current}
  />
  <AgentTabType {tab} {workspaceId} isActive isPanelFocused />
</section>

<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import BrowserTabType from '../../BrowserTabType.svelte';

  let {
    tabs,
    activeTabId,
    width = 640,
    renderPanelHeader = false,
  }: {
    tabs: PanelTab[];
    activeTabId: string;
    width?: number;
    renderPanelHeader?: boolean;
  } = $props();
  const header = createPanelHeaderContext();
</script>

<div class="flex h-90 flex-col overflow-hidden bg-card" style:width={`${width}px`}>
  {#if renderPanelHeader}
    <PanelTabBar
      {tabs}
      {activeTabId}
      panelId="browser-panel"
      workspaceId="workspace-1"
      isFocused
      contentActions={header.actions.current}
      onTabClick={() => {}}
      onTabClose={() => {}}
    />
  {:else}
    <div data-testid="panel-header">
      {@render header.actions.current?.primary?.()}
    </div>
  {/if}
  {#each tabs as tab (tab.id)}
    <div class="min-h-0 flex-1" hidden={activeTabId !== tab.id}>
      <BrowserTabType
        {tab}
        workspaceId="workspace-1"
        isActive={activeTabId === tab.id}
        isPanelFocused={false}
      />
    </div>
  {/each}
</div>

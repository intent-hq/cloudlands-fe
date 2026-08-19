<script lang="ts">
  import { onDestroy } from 'svelte';
  import type {
    PanelTab,
    PanelTabType,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import * as Menu from '$lib/components/ui/menu';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    panelType = 'agent',
    width = 240,
    zoom = 2,
  }: { panelType?: PanelTabType; width?: number; zoom?: number } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  let displayCount = $state(0);
  let contentCount = $state(0);
  let zoomCount = $state(0);
  let splitCount = $state(0);
  let moveLeftCount = $state(0);
  let moveRightCount = $state(0);
  let closeCount = $state(0);

  const activeTab = $derived<PanelTab>({
    id: `${panelType}-tab`,
    type: panelType,
    title: `${panelType} panel`,
    closable: true,
    agentId: panelType === 'agent' ? 'panel-menu-agent' : undefined,
  });
</script>

{#snippet contentDisplayAction()}
  <Menu.CommandItem label="Content display action" onclick={() => (displayCount += 1)} />
{/snippet}

{#snippet contentCommandAction()}
  <Menu.CommandItem label="Content command action" onclick={() => (contentCount += 1)} />
{/snippet}

<section
  class="overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="panel-actions-host"
  data-display-count={displayCount}
  data-content-count={contentCount}
  data-zoom-count={zoomCount}
  data-split-count={splitCount}
  data-move-left-count={moveLeftCount}
  data-move-right-count={moveRightCount}
  data-close-count={closeCount}
>
  <PanelTabBar
    tabs={[activeTab]}
    activeTabId={activeTab.id}
    panelId="panel-actions"
    workspaceId="panel-actions-workspace"
    contentActions={{ display: contentDisplayAction, actions: contentCommandAction }}
    onZoomToggle={() => (zoomCount += 1)}
    onSplitHorizontal={() => (splitCount += 1)}
    onMoveLeft={() => (moveLeftCount += 1)}
    onMoveRight={() => (moveRightCount += 1)}
    onClosePanel={() => (closeCount += 1)}
    isFocused
  />
</section>

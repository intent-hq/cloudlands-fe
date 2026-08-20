<script lang="ts">
  import { onDestroy } from 'svelte';
  import type {
    PanelTab,
    PanelTabType,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import * as Menu from '$lib/components/ui/menu';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    panelType = 'agent',
    width = 240,
    zoom = 2,
    initialCount = 2,
    isRightmostPanel = true,
    theme = 'light',
  }: {
    panelType?: PanelTabType;
    width?: number;
    zoom?: number;
    initialCount?: PanelColumnCount;
    isRightmostPanel?: boolean;
    theme?: 'light' | 'dark';
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const workspaceId = 'panel-actions-workspace';
  const count$ = selectPanelColumnCount(workspaceId);
  store.dispatch(clearPanelLayout(workspaceId));
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'panel-actions' },
      panels: { 'panel-actions': { id: 'panel-actions', tabs: [], activeTabId: null } },
      focusedPanelId: 'panel-actions',
      columnCount: initialCount,
    }),
  );
  onDestroy(() => {
    store.dispatch(clearPanelLayout(workspaceId));
    disposeStore();
  });

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

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
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
  data-current-count={$count$}
>
  <PanelTabBar
    tabs={[activeTab]}
    activeTabId={activeTab.id}
    panelId="panel-actions"
    {workspaceId}
    {isRightmostPanel}
    contentActions={{ display: contentDisplayAction, actions: contentCommandAction }}
    onZoomToggle={() => (zoomCount += 1)}
    onSplitHorizontal={() => (splitCount += 1)}
    onMoveLeft={() => (moveLeftCount += 1)}
    onMoveRight={() => (moveRightCount += 1)}
    onClosePanel={() => (closeCount += 1)}
    isFocused
  />
</section>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import type {
    PanelColumnCount,
    PanelTab,
    PanelTabType,
    WorkspacePanelLayoutState,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
    preparePanelLayoutBackendRestore,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import * as Menu from '$lib/components/ui/menu';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    panelType = 'agent',
    width = 240,
    zoom = 2,
    initialCount = 2,
    workspaceId = 'panel-actions-workspace',
    isRightmostPanel = true,
    theme = 'light',
    populated = true,
    stackCount = 2,
  }: {
    panelType?: PanelTabType;
    width?: number;
    zoom?: number;
    initialCount?: PanelColumnCount;
    workspaceId?: string;
    isRightmostPanel?: boolean;
    theme?: 'light' | 'dark';
    populated?: boolean;
    stackCount?: 1 | 2 | 3 | 4 | 5;
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const primaryWorkspaceId = 'panel-actions-workspace';
  const alternateWorkspaceId = 'panel-actions-alternate';
  // svelte-ignore state_referenced_locally - initial value is synchronized by the effect below
  const workspaceIdStore = writable(workspaceId);
  const count$ = selectPanelColumnCount(workspaceIdStore);

  function panelLayout(
    count: PanelColumnCount,
  ): Pick<WorkspacePanelLayoutState, 'root' | 'panels' | 'focusedPanelId' | 'columnCount'> {
    return {
      root: { type: 'panel', panelId: 'panel-actions' },
      panels: { 'panel-actions': { id: 'panel-actions', tabs: [], activeTabId: null } },
      focusedPanelId: 'panel-actions',
      columnCount: count,
    };
  }

  store.dispatch(clearPanelLayout(primaryWorkspaceId));
  store.dispatch(clearPanelLayout(alternateWorkspaceId));
  // svelte-ignore state_referenced_locally - this prop seeds the initial test state only
  store.dispatch(initializeLayout(primaryWorkspaceId, panelLayout(initialCount)));
  store.dispatch(initializeLayout(alternateWorkspaceId, panelLayout(4)));

  $effect(() => workspaceIdStore.set(workspaceId));

  function restoreCurrentWorkspace() {
    store.dispatch(preparePanelLayoutBackendRestore(workspaceId));
    store.dispatch(initializeLayout(workspaceId, panelLayout(3)));
  }

  onDestroy(() => {
    store.dispatch(clearPanelLayout(primaryWorkspaceId));
    store.dispatch(clearPanelLayout(alternateWorkspaceId));
    disposeStore();
  });

  let displayCount = $state(0);
  let contentCount = $state(0);
  let navigationCount = $state(0);
  let zoomCount = $state(0);
  let splitCount = $state(0);
  let moveLeftCount = $state(0);
  let moveRightCount = $state(0);
  let closeCount = $state(0);

  const tabs = $derived<PanelTab[]>(
    Array.from({ length: stackCount }, (_, index) => ({
      id: `${panelType}-tab-${index + 1}`,
      type: panelType,
      title: `${panelType} panel ${index + 1}`,
      closable: true,
      agentId: panelType === 'agent' ? `panel-menu-agent-${index + 1}` : undefined,
    })),
  );
  // svelte-ignore state_referenced_locally - the prop seeds the test harness state
  let activeTabId = $state(`${panelType}-tab-1`);

  $effect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id ?? '';
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });
</script>

{#snippet contentDisplayAction()}
  <Menu.CommandItem label="Content display action" onclick={() => (displayCount += 1)} />
{/snippet}

{#snippet contentNavigationAction()}
  <button
    type="button"
    class="size-7 shrink-0"
    aria-label="Content navigation"
    onclick={() => (navigationCount += 1)}
  >
    <span aria-hidden="true">N</span>
  </button>
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
  data-navigation-count={navigationCount}
  data-zoom-count={zoomCount}
  data-split-count={splitCount}
  data-move-left-count={moveLeftCount}
  data-move-right-count={moveRightCount}
  data-close-count={closeCount}
  data-current-count={$count$}
  data-active-tab={activeTabId}
>
  <PanelTabBar
    tabs={populated ? tabs : []}
    activeTabId={populated ? activeTabId : null}
    panelId="panel-actions"
    {workspaceId}
    {isRightmostPanel}
    contentActions={{
      primary: contentNavigationAction,
      display: contentDisplayAction,
      actions: contentCommandAction,
    }}
    onZoomToggle={() => (zoomCount += 1)}
    onSplitHorizontal={() => (splitCount += 1)}
    onMoveLeft={() => (moveLeftCount += 1)}
    onMoveRight={() => (moveRightCount += 1)}
    onTabClick={(tabId) => (activeTabId = tabId)}
    onTabClose={() => (closeCount += 1)}
    onClosePanel={() => (closeCount += 1)}
    isFocused
  />
  <button class="sr-only" data-testid="restore-column-count" onclick={restoreCurrentWorkspace}>
    Restore three columns
  </button>
</section>

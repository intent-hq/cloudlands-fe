<script module lang="ts">
  import type { RootStoreHmrData } from '$store/renderer/root-store-lifecycle';

  const storeLifecycleData: RootStoreHmrData = {};
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import WorkspaceColumnsView from '../../WorkspaceColumnsView.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { WorkspaceStatus } from '$shared/types';
  import { store as appStore } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
  import { workspaceNavigationTabSaga } from '$store/renderer/slices/workspace-navigation/sagas/workspace-navigation-tab-saga';
  import {
    closePanel,
    focusPanel,
    initializeLayout,
    movePanel,
    openTab,
    setRestoreStatus,
    updateSplitSizes,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectFocusedPanelId,
    selectPanelIds,
    selectPendingPanelReveal,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { hydrateResizablePanelSize } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  let { onReady, workspaceKey }: { onReady: () => void; workspaceKey: string } = $props();

  const workspaceId = WorkspaceId(`workspace-panel-reveal-${workspaceKey}`);
  const targetFilePath = '/tmp/reveal-target.ts';
  const timestamp = '2026-08-16T12:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(
    appStore,
    {
      startSagas: (store) => [
        store.runSaga(appLayoutNavigationSaga),
        store.runSaga(workspaceNavigationTabSaga),
      ],
    },
    storeLifecycleData,
  );
  appStore.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Panel reveal browser test',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  appStore.dispatch(openWorkspaceTab(workspaceId));
  for (const [key, value] of [
    [`workspace-left-panel-width:${workspaceId}`, 280],
    [`workspace-left-panel-expanded-width:${workspaceId}`, 600],
  ] as const) {
    appStore.dispatch(hydrateResizablePanelSize(key, value));
  }
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'source-panel' },
          { type: 'panel', panelId: 'target-panel' },
        ],
      },
      panels: {
        'source-panel': {
          id: 'source-panel',
          tabs: [
            {
              id: 'source-tab',
              type: 'file',
              title: 'Source file',
              filePath: '/tmp/reveal-source.ts',
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'source-tab',
        },
        'target-panel': {
          id: 'target-panel',
          tabs: [
            {
              id: 'target-tab',
              type: 'file',
              title: 'Reveal target with a deliberately long title that must truncate',
              filePath: targetFilePath,
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'target-tab',
        },
      },
      focusedPanelId: 'source-panel',
      canvasWidth: 600,
    }),
  );
  appStore.dispatch(setRestoreStatus(workspaceId, 'restored'));

  const pendingReveal$ = selectPendingPanelReveal(workspaceId);
  const focusedPanelId$ = selectFocusedPanelId(workspaceId);
  const panelIds$ = selectPanelIds(workspaceId);
  let sawPendingReveal = $state(false);
  $effect(() => {
    if ($pendingReveal$) sawPendingReveal = true;
  });

  function revealEquivalentPanel() {
    appStore.dispatch(
      openTab(
        workspaceId,
        {
          type: 'file',
          title: 'Reveal target',
          filePath: targetFilePath,
          workspaceId,
          closable: true,
        },
        'source-panel',
        'browser-reveal-request',
        true,
        Date.parse(timestamp),
      ),
    );
  }

  function openFileAdjacent() {
    appStore.dispatch(
      openWorkspaceFile(workspaceId, '/tmp/production-file.ts', {
        openInAdjacentPanel: true,
        sourcePanelId: 'source-panel',
      }),
    );
  }

  function openNoteAdjacent() {
    appStore.dispatch(
      openWorkspaceNote(workspaceId, 'production-note', {
        openInAdjacentPanel: true,
        sourcePanelId: 'source-panel',
      }),
    );
  }

  function openAgentColumn() {
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId: 'production-agent',
        openInNewColumn: true,
        panelLayoutId: workspaceId,
      }),
    );
  }

  function focusExistingPanel() {
    appStore.dispatch(focusPanel(workspaceId, 'target-panel'));
  }

  function focusThenRemovePanel() {
    appStore.dispatch(focusPanel(workspaceId, 'target-panel'));
    appStore.dispatch(closePanel(workspaceId, 'target-panel'));
  }

  function useMixedPanelWidths() {
    appStore.dispatch(updateSplitSizes(workspaceId, [30, 70]));
  }

  function reorderPanels() {
    appStore.dispatch(movePanel(workspaceId, 'target-panel', 'source-panel', 'before'));
  }

  function closeExtraPanel() {
    const extraPanelId = $panelIds$.find(
      (panelId) => panelId !== 'source-panel' && panelId !== 'target-panel',
    );
    if (extraPanelId) appStore.dispatch(closePanel(workspaceId, extraPanelId));
  }

  onMount(() => {
    onReady();
  });
  onDestroy(disposeStore);
</script>

<button type="button" onclick={revealEquivalentPanel} data-reveal-trigger>Reveal</button>
<button type="button" onclick={openFileAdjacent} data-open-file>Open file</button>
<button type="button" onclick={openNoteAdjacent} data-open-note>Open note</button>
<button type="button" onclick={openAgentColumn} data-open-agent>Open agent</button>
<button type="button" onclick={focusExistingPanel} data-focus-panel>Focus panel</button>
<button type="button" onclick={focusThenRemovePanel} data-remove-panel>Remove panel</button>
<button type="button" onclick={useMixedPanelWidths} data-mix-panel-widths>Mix widths</button>
<button type="button" onclick={reorderPanels} data-reorder-panels>Reorder panels</button>
<button type="button" onclick={closeExtraPanel} data-close-extra-panel>Close extra panel</button>
<div
  class="h-[480px] overflow-hidden"
  data-reveal-state
  data-saw-pending-reveal={sawPendingReveal}
  data-pending-panel-reveal={$pendingReveal$?.requestId ?? ''}
  data-focused-panel-id={$focusedPanelId$ ?? ''}
  data-panel-count={$panelIds$.length}
>
  <WorkspaceColumnsView />
</div>

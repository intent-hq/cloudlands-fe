<script lang="ts">
  import WorkspaceColumnsView from '../../WorkspaceColumnsView.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { WorkspaceStatus } from '$shared/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    initializeLayout,
    openTab,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPendingPanelReveal } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { hydrateResizablePanelSize } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  let { viewportWidth = 400, zoom = 2 }: { viewportWidth?: number; zoom?: number } = $props();

  const workspaceId = WorkspaceId('workspace-panel-reveal-browser');
  const targetFilePath = '/tmp/reveal-target.ts';
  const timestamp = '2026-08-16T12:00:00.000Z';
  appStore.init();
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
        'source-panel': { id: 'source-panel', tabs: [], activeTabId: null },
        'target-panel': {
          id: 'target-panel',
          tabs: [
            {
              id: 'target-tab',
              type: 'file',
              title: 'Reveal target',
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
</script>

<div style:width={`${viewportWidth}px`} style:height="520px" style:zoom data-reveal-host>
  <button type="button" onclick={revealEquivalentPanel} data-reveal-trigger>Reveal</button>
  <div
    class="h-[480px] overflow-hidden"
    data-reveal-state
    data-saw-pending-reveal={sawPendingReveal}
    data-pending-panel-reveal={$pendingReveal$?.requestId ?? ''}
  >
    <WorkspaceColumnsView />
  </div>
</div>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { dockPlacementSaga } from '$store/renderer/slices/hud/sagas/dock-placement-saga';
  import {
    dockActivated,
    dockPlacementCommandRequested,
  } from '$store/renderer/slices/hud/hud-slice';
  import {
    selectDockPlacement,
    selectDockFocusRequest,
    selectDockPlacementError,
    selectDockDragStartResult,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import DockRail from '$features/hud/components/DockRail.svelte';
  import { dockRailPreview } from '$features/hud/components/dock-rail.preview-fixtures';

  const route = location.pathname;
  const stop = startRootStoreLifecycle(store, {
    startSagas: () => {
      if (route === '/dock') store.dispatch(dockActivated());
      return route === '/dock' ? [store.runSaga(dockPlacementSaga)] : [];
    },
  });
  onDestroy(stop);
  store.dispatch(guestSessionsListUnavailable());
  const placement$ = selectDockPlacement();
  const focusRequest$ = selectDockFocusRequest();
  const placementError$ = selectDockPlacementError();
  const dragStartResult$ = selectDockDragStartResult();
  const marker = crypto.randomUUID();
  let opened = $state<string[]>([]);
  const commands: unknown[] = [];
  const allWorkspaces = dockRailPreview.states['twelve-overflow'].props.workspaces;
  let workspaces = $state.raw(allWorkspaces);
  onMount(() => {
    // Only fixture data and evidence are exposed. Native placement stays in the
    // production bridge, controller, and local preference writer.
    Object.assign(window, {
      companionFixture: {
        marker,
        setUpdateWorkspaceCount(count: number, running = true) {
          const updated = allWorkspaces.slice(0, count).map((item, index) => ({
            ...item,
            isUnread: index % 2 === 0,
            priorityGroup: index % 2 === 0 ? ('action' as const) : ('unread' as const),
            isRunning: false,
          }));
          // Every entry is updated; the first has both flags and must count only once.
          for (const item of updated) if (item.priorityGroup === 'unread') item.isUnread = true;
          workspaces = [
            ...updated,
            ...(running
              ? allWorkspaces
                  .filter(
                    (item) => item.isRunning && !item.isUnread && item.priorityGroup !== 'action',
                  )
                  .slice(-1)
              : []),
          ];
        },
        evidence: () => ({
          marker,
          opened: [...opened],
          commands: [...commands],
        }),
      },
    });
  });
</script>

<Tooltip.Provider>
  <main data-testid="companion-native-fixture" data-route={route} data-marker={marker}>
    {#if $placement$}
      <DockRail
        {workspaces}
        staticData
        placement={$placement$}
        focusRequest={$focusRequest$}
        placementError={$placementError$}
        dragStartResult={$dragStartResult$}
        onPlacementCommand={(command) => {
          commands.push(command);
          store.dispatch(dockPlacementCommandRequested(command));
        }}
        onOpenWorkspace={(id) => {
          opened = [...opened, id];
        }}
        onOpenAssistant={() => {
          opened = [...opened, 'assistant'];
        }}
        onOpenHud={() => {
          opened = [...opened, 'hud'];
        }}
      />
    {/if}
  </main>
</Tooltip.Provider>

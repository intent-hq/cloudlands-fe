<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { annotationSaga } from '$store/renderer/slices/annotation/sagas/annotation-saga';
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
  import AnnotationToolbar from '$features/annotation/components/AnnotationToolbar.svelte';
  import AnnotationOverlay from '$features/annotation/components/AnnotationOverlay.svelte';

  const route = location.pathname;
  const stop = startRootStoreLifecycle(store, {
    startSagas: () => {
      if (route === '/dock') store.dispatch(dockActivated());
      return [
        store.runSaga(annotationSaga),
        ...(route === '/dock' ? [store.runSaga(dockPlacementSaga)] : []),
      ];
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
  const pointerEvents: unknown[] = [];
  const motionFrames: unknown[] = [];
  let motionFrame: number | undefined;
  let motionLabel = '';
  const allWorkspaces = dockRailPreview.states['twelve-overflow'].props.workspaces;
  let workspaces = $state.raw(allWorkspaces);
  onMount(() => {
    // Only fixture data and evidence are exposed. Native placement stays in the
    // production bridge, controller, and local preference writer.
    Object.assign(window, {
      companionFixture: {
        marker,
        startMotionEvidence() {
          if (motionFrame !== undefined) cancelAnimationFrame(motionFrame);
          motionFrames.length = 0;
          const sample = (time: number) => {
            const shell = document.querySelector('[data-testid="dock-shell"]');
            const surface = document.querySelector('[data-testid="dock-surface"]');
            const path = surface?.querySelector<SVGGraphicsElement>('.shell-silhouette path');
            const overview = document.querySelector('[data-testid="dock-overview"]');
            const focus = document.activeElement;
            const focusStyle = focus ? getComputedStyle(focus) : null;
            const snapshot = store.state.hud.dockPlacement;
            const rect = (element?: Element | null) => {
              const r = element?.getBoundingClientRect();
              return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
            };
            motionFrames.push({
              time,
              label: motionLabel,
              expanded: shell?.getAttribute('data-expanded'),
              reveal: shell?.getAttribute('data-reveal'),
              surface: rect(surface),
              silhouette: rect(path),
              clip: surface?.querySelector('.companion-content')
                ? getComputedStyle(surface.querySelector('.companion-content')!).clipPath
                : null,
              overview: overview
                ? {
                    ...rect(overview),
                    opacity: getComputedStyle(overview.parentElement!).opacity,
                    transform: getComputedStyle(overview.parentElement!).transform,
                    inert: Boolean(overview.closest('[inert]')),
                  }
                : null,
              placement: snapshot
                ? {
                    revision: snapshot.revision,
                    surface: { ...snapshot.surface },
                    windowBounds: { ...snapshot.windowBounds },
                  }
                : null,
              focus: focusStyle
                ? {
                    testId: focus?.getAttribute('data-testid'),
                    label: focus?.getAttribute('aria-label'),
                    visible: focus?.matches(':focus-visible'),
                    outlineColor: focusStyle.outlineColor,
                    outlineWidth: focusStyle.outlineWidth,
                    outlineStyle: focusStyle.outlineStyle,
                    boxShadow: focusStyle.boxShadow,
                    backgroundColor: focusStyle.backgroundColor,
                  }
                : null,
            });
            // Bounded observation only; never drive the product animation clock.
            if (motionFrames.length < 3600) motionFrame = requestAnimationFrame(sample);
          };
          motionFrame = requestAnimationFrame(sample);
        },
        markMotionEvidence(label: string) {
          motionLabel = label;
        },
        stopMotionEvidence() {
          if (motionFrame !== undefined) cancelAnimationFrame(motionFrame);
          motionFrame = undefined;
          return [...motionFrames];
        },
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
        async diagnoseLastBeginBridge() {
          const command = commands.findLast((entry: any) => entry.action === 'begin-drag');
          try {
            return {
              response: await window.electronAPI!.invoke(
                'window:update-dock-placement',
                command as any,
              ),
            };
          } catch (error) {
            return { error: String(error) };
          }
        },
        evidence: () => ({
          marker,
          opened: [...opened],
          draft: store.state.annotation.draft,
          commands: [...commands],
          pointerEvents: [...pointerEvents],
          dragStartResult: store.state.hud.dockDragStartResult,
        }),
      },
    });
    const recordPointer = (event: PointerEvent) => {
      pointerEvents.push({
        type: event.type,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        isPrimary: event.isPrimary,
        button: event.button,
        target: (event.target as HTMLElement)
          ?.closest('[data-testid]')
          ?.getAttribute('data-testid'),
      });
      if (pointerEvents.length > 40) pointerEvents.shift();
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      window.addEventListener(type, recordPointer as EventListener, true);
    return () => {
      if (motionFrame !== undefined) cancelAnimationFrame(motionFrame);
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        window.removeEventListener(type, recordPointer as EventListener, true);
    };
  });
</script>

<Tooltip.Provider>
  <main data-testid="companion-native-fixture" data-route={route} data-marker={marker}>
    {#if route === '/annotation-toolbar'}
      <AnnotationToolbar />
    {:else if route === '/annotation'}
      <AnnotationOverlay />
    {:else if $placement$}
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

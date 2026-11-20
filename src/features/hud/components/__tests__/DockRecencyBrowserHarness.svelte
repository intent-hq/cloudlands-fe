<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { dockRecencySaga } from '$store/renderer/slices/hud/sagas/dock-recency-saga';
  import { dockActivated, hudDeactivated } from '$store/renderer/slices/hud/hud-slice';
  import { selectDockWorkspaces } from '$store/renderer/slices/hud/hud-selectors';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { dockRecencyScenarios } from '../dock-rail.preview-fixtures';
  import DockRail from '../DockRail.svelte';
  import Preview from '../dock-rail.preview.svelte';
  import {
    dockRailPreview,
    adaptiveDockFixture,
    type DockRailPreviewProps,
  } from '../dock-rail.preview-fixtures';
  import {
    resolveFloatingDockGeometry,
    dockWindowEnvelope,
    dockLocalRect,
    DOCK_FLOATING_COMPACT_SIZE,
    DOCK_FLOATING_SHADOW_MARGIN,
  } from '$shared/dock-placement';
  import '$lib/styles/dock-tokens.css';

  let {
    unavailable = false,
    allOld = false,
    total = 8,
    mode = 'legacy',
    smallWorkArea = false,
  }: {
    unavailable?: boolean;
    allOld?: boolean;
    total?: number;
    mode?: 'legacy' | 'notch' | 'floating-down' | 'floating-up';
    smallWorkArea?: boolean;
  } = $props();
  const scenarios = allOld
    ? Array.from({ length: total }, (_, index) => {
        const base = dockRecencyScenarios[0].item;
        return {
          item: {
            ...base,
            workspace: {
              ...base.workspace,
              id: `old-human-${index + 1}` as typeof base.workspace.id,
              title: `Older human workspace ${index + 1}`,
              repositoryOwner: 'demo/team',
            },
          },
          messages: [
            {
              id: `human-${index + 1}`,
              preview: 'Please review this workspace',
              createdAt: new Date(
                Date.parse('2026-10-19T12:00:00.000Z') - (30 + index) * 3_600_000,
              ).toISOString(),
            },
          ],
        };
      })
    : dockRecencyScenarios;
  const workspaces$ = selectDockWorkspaces();
  const older$ = selectDockWorkspaces('older');
  function shellProps(): DockRailPreviewProps {
    if (mode === 'notch') return dockRailPreview.states.notch.props;
    const height = smallWorkArea ? 300 : 900;
    const display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 640, height },
      workArea: { x: 0, y: 0, width: 640, height },
      cutout: null,
    };
    const target = {
      kind: 'floating',
      displayId: 1,
      x: 0.5,
      y: mode === 'floating-up' ? 0.9 : 0.1,
    } as const;
    const geometry = resolveFloatingDockGeometry(target, display, DOCK_FLOATING_COMPACT_SIZE);
    const windowBounds = dockWindowEnvelope(
      geometry.surface,
      display,
      null,
      null,
      true,
      DOCK_FLOATING_SHADOW_MARGIN,
    );
    return {
      ...dockRailPreview.states.floating.props,
      viewportHeight: height,
      floatingDisplay: display,
      placement: {
        ...adaptiveDockFixture('floating'),
        placement: target,
        windowBounds,
        surface: dockLocalRect(geometry.surface, windowBounds),
        workArea: dockLocalRect(display.workArea, windowBounds),
        floatingAnchor: dockLocalRect(geometry.anchor, windowBounds),
        expansionDirection: geometry.expansionDirection,
      },
    };
  }
  const previewProps = shellProps();
  let requests = $state<Array<{ method: string; params: unknown }>>([]);
  const pointerController = { activate: () => {}, deactivate: () => {}, destroy: () => {} };

  onMount(() => {
    const previousBridge = window.electronAPI;
    installMockElectronBridge({
      'agent.list': (params) => {
        requests = [...requests, { method: 'agent.list', params }];
        const { workspaceId, scope } = params as { workspaceId: string; scope: string };
        const scenarioIndex = scenarios.findIndex(({ item }) => item.workspace.id === workspaceId);
        // Exercise all three bins, including human contact with delegated/background agents.
        const expectedScope = ['topLevel', 'delegated', 'background'][scenarioIndex % 3];
        return {
          agents:
            scope === expectedScope
              ? [
                  {
                    id: `agent:${workspaceId}`,
                    workspaceId,
                    name: 'Conversation agent',
                    status: 'idle',
                    createdAt: '2026-10-18T00:00:00Z',
                    updatedAt: '2026-10-19T12:00:00Z',
                    lastMessageId: 'fixture-last-message',
                  },
                ]
              : [],
        };
      },
      'agent.listUserMessages': (params) => {
        requests = [...requests, { method: 'agent.listUserMessages', params }];
        if (unavailable) throw new Error('Message index temporarily unavailable');
        const { workspaceId } = params as { workspaceId: string };
        const items =
          scenarios.find(({ item }) => item.workspace.id === workspaceId)?.messages ?? [];
        return { items, total: items.length };
      },
    });
    store.dispatch(dockActivated());
    store.dispatch(replaceWorkspaceList(scenarios.map(({ item }) => item.workspace)));
    const stop = store.runSaga(dockRecencySaga);
    return () => {
      stop();
      store.dispatch(hudDeactivated());
      store.dispatch(replaceWorkspaceList([]));
      window.electronAPI = previousBridge;
    };
  });
</script>

<section
  data-testid="dock-recency-boundary"
  data-requests={JSON.stringify(requests)}
  data-visible-ids={JSON.stringify($workspaces$.map(({ workspace }) => String(workspace.id)))}
  data-older-ids={JSON.stringify($older$.map(({ workspace }) => String(workspace.id)))}
  style:height={mode === 'legacy' ? '600px' : undefined}
  style:width={mode === 'legacy' ? '646px' : undefined}
>
  {#if mode !== 'legacy'}
    <Preview {...previewProps} workspaces={$workspaces$} olderWorkspaces={$older$} />
  {:else}
    <DockRail
      workspaces={$workspaces$}
      viewportHeight={600}
      {pointerController}
      staticData
      onOpenWorkspace={() => {}}
      onOpenAssistant={() => {}}
      onOpenHud={() => {}}
      onAnnotate={async () => {}}
    />
  {/if}
</section>

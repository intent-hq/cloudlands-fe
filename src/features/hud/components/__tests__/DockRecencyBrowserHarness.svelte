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

  let { unavailable = false }: { unavailable?: boolean } = $props();
  const workspaces$ = selectDockWorkspaces();
  let requests = $state<Array<{ method: string; params: unknown }>>([]);
  const pointerController = { activate: () => {}, deactivate: () => {}, destroy: () => {} };

  onMount(() => {
    const previousBridge = window.electronAPI;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture mocks only the IPC boundary; production saga and selector own data
    installMockElectronBridge({
      'agent.list': (params) => {
        requests = [...requests, { method: 'agent.list', params }];
        const { workspaceId, scope } = params as { workspaceId: string; scope: string };
        const scenarioIndex = dockRecencyScenarios.findIndex(
          ({ item }) => item.workspace.id === workspaceId,
        );
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
          dockRecencyScenarios.find(({ item }) => item.workspace.id === workspaceId)?.messages ??
          [];
        return { items, total: items.length };
      },
    });
    store.dispatch(dockActivated());
    store.dispatch(replaceWorkspaceList(dockRecencyScenarios.map(({ item }) => item.workspace)));
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
  style="height: 600px; width: 646px"
>
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
</section>

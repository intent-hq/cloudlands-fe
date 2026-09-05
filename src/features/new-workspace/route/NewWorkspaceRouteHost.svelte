<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import UntitledWorkspaceShell from '../ui/UntitledWorkspaceShell.svelte';
  import { createInitialControllerState, type ControllerState } from '../controller';
  import { consumeNewWorkspaceStartInput } from './new-workspace-navigation';
  import { createNewWorkspaceRouteController } from './new-workspace-route-controller';
  import { setWorkspaceCreationActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { checkSingleProviderRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { selectHasCheckedOnce } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import { selectIsActiveProviderAvailable } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectWorkspaceCreationDefaultParentPath } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors';

  interface Props {
    url: URL;
  }

  let { url }: Props = $props();
  const requestedDraftId = url.searchParams.get('draft');
  const routeController = createNewWorkspaceRouteController({
    startInput: consumeNewWorkspaceStartInput(url),
    requestedDraftId,
  });
  let state = $state<ControllerState>(createInitialControllerState(1));
  const hasCheckedProviders$ = selectHasCheckedOnce();
  const activeProviderAvailable$ = selectIsActiveProviderAvailable();
  const defaultParentPath$ = selectWorkspaceCreationDefaultParentPath();

  $effect(() => {
    if (!$hasCheckedProviders$) return;
    routeController.dispatch({
      type: 'capability.result',
      generation: state.generation,
      capability: 'provider',
      status: $activeProviderAvailable$ ? 'ready' : 'missing',
    });
  });

  function selectProvider(providerId: string): void {
    appStore.dispatch(setActiveProvider(providerId));
    appStore.dispatch(checkSingleProviderRequested(providerId));
  }

  onMount(() => {
    appStore.dispatch(setWorkspaceCreationActive(true));
    void routeController.start((next) => {
      state = next;
      if (next.phase === 'live') void goto(`/workspace/${next.workspaceId}`);
    });
  });

  onDestroy(() => {
    routeController.stop();
    appStore.dispatch(setWorkspaceCreationActive(false));
  });
</script>

<div class="h-full p-3">
  <UntitledWorkspaceShell
    {state}
    onEdit={(patch) => routeController.edit(patch)}
    onStart={(requiredCapabilities) =>
      routeController.dispatch({ type: 'start.requested', requiredCapabilities })}
    onRetry={() => routeController.dispatch({ type: 'retry' })}
    onReconnect={() => routeController.dispatch({ type: 'reconnect' })}
    onAcceptRemote={() => routeController.dispatch({ type: 'conflict.acceptRemote' })}
    onKeepLocal={() => routeController.dispatch({ type: 'conflict.keepLocal' })}
    onSourceSelected={(source) => routeController.edit({ source })}
    onChooseNewFolder={(name) =>
      routeController.edit({
        source: { kind: 'newFolder', parentPath: $defaultParentPath$, name },
      })}
    onProviderSelected={selectProvider}
  />
</div>

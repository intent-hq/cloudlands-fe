<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import UntitledWorkspaceShell from '../ui/UntitledWorkspaceShell.svelte';
  import { createInitialControllerState, type ControllerState } from '../controller';
  import { consumeNewWorkspaceStartInput } from './new-workspace-navigation';
  import { createNewWorkspaceRouteController } from './new-workspace-route-controller';
  import { setOnboardingActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';

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

  onMount(() => {
    appStore.dispatch(setOnboardingActive(true));
    void routeController.start((next) => {
      state = next;
      if (next.phase === 'live') void goto(`/workspace/${next.workspaceId}`);
    });
  });

  onDestroy(() => {
    routeController.stop();
    appStore.dispatch(setOnboardingActive(false));
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
  />
</div>
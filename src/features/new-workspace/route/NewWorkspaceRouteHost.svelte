<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import UntitledWorkspaceShell from '../ui/UntitledWorkspaceShell.svelte';
  import { createInitialControllerState, type ControllerState } from '../controller';
  import {
    consumeNewWorkspaceStartInput,
    requestedDraftIdForRoute,
  } from './new-workspace-navigation';
  import { createNewWorkspaceRouteController } from './new-workspace-route-controller';
  import { setWorkspaceCreationActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { checkSingleProviderRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { selectHasCheckedOnce } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import {
    selectAvailableEnabledProviderIds,
    selectHasEnabledCatalogProvider,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectWorkspaceCreationDefaultParentPath } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors';
  import {
    selectDaemonConnectionGeneration,
    selectDaemonHealth,
    selectDaemonHostRepairTarget,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { stageNewWorkspaceFiles } from './new-workspace-attachments';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import RemoteDaemonPathGuidance from './RemoteDaemonPathGuidance.svelte';
  import { providerCapabilityStatus } from '../ui/types';

  interface Props {
    url: URL;
  }

  let { url }: Props = $props();
  const requestedDraftId = requestedDraftIdForRoute(url);
  const routeController = createNewWorkspaceRouteController({
    startInput: consumeNewWorkspaceStartInput(url),
    requestedDraftId,
  });
  let remoteDaemonPathRejection = $state(routeController.remoteDaemonPathRejection);
  let controllerState = $state<ControllerState>(createInitialControllerState(1));
  let fileInput: HTMLInputElement | undefined = $state();
  const hasCheckedProviders$ = selectHasCheckedOnce();
  const providerCatalogLoaded$ = selectProviderCatalogLoaded();
  const hasEnabledProvider$ = selectHasEnabledCatalogProvider();
  const availableProviderIds$ = selectAvailableEnabledProviderIds();
  const defaultParentPath$ = selectWorkspaceCreationDefaultParentPath();
  const daemonHealth$ = selectDaemonHealth();
  const daemonConnectionGeneration$ = selectDaemonConnectionGeneration();
  const daemonHostRepairTarget$ = selectDaemonHostRepairTarget();

  $effect(() => {
    if ($daemonConnectionGeneration$ === 0 && $daemonHealth$ === 'down') return;
    routeController.setDaemonConnected($daemonHealth$ !== 'down');
  });

  $effect(() => {
    const status = providerCapabilityStatus({
      catalogLoaded: $providerCatalogLoaded$,
      hasEnabledProvider: $hasEnabledProvider$,
      hasCheckedOnce: $hasCheckedProviders$,
      hasAvailableProvider: $availableProviderIds$.length > 0,
    });
    if (status === null) return;
    routeController.dispatch({
      type: 'capability.result',
      generation: controllerState.generation,
      capability: 'provider',
      status,
    });
  });

  function selectProvider(providerId: string): void {
    appStore.dispatch(setActiveProvider(providerId));
    appStore.dispatch(checkSingleProviderRequested(providerId));
  }

  async function handleFilesSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    const added = await stageNewWorkspaceFiles(files);
    for (const item of added) {
      if (item.placementStatus === 'failed') {
        toast.error(m.workspaceCreation_promptStep_attachmentNoPath_error({ name: item.label }));
      }
    }
    routeController.edit({ attachments: [...controllerState.input.attachments, ...added] });
  }

  onMount(() => {
    appStore.dispatch(setWorkspaceCreationActive(true));
    void routeController.start((next) => {
      controllerState = next;
      if (next.phase === 'live') void goto(`/workspace/${next.workspaceId}`);
    });
  });

  onDestroy(() => {
    routeController.stop();
    appStore.dispatch(setWorkspaceCreationActive(false));
  });
</script>

<input class="hidden" type="file" multiple bind:this={fileInput} onchange={handleFilesSelected} />
<div class="relative h-full">
  {#if remoteDaemonPathRejection}
    <RemoteDaemonPathGuidance path={remoteDaemonPathRejection} />
  {/if}
  <UntitledWorkspaceShell
    state={controllerState}
    presentation={{ host: $daemonHostRepairTarget$ }}
    onEdit={(patch) => routeController.edit(patch)}
    onFlush={() => routeController.flush()}
    onStart={(requiredCapabilities) => {
      routeController.flush();
      routeController.dispatch({ type: 'start.requested', requiredCapabilities });
    }}
    onRetry={() => routeController.dispatch({ type: 'retry' })}
    onReconnect={() => routeController.dispatch({ type: 'reconnect' })}
    onAcceptRemote={() => routeController.dispatch({ type: 'conflict.acceptRemote' })}
    onKeepLocal={() => routeController.dispatch({ type: 'conflict.keepLocal' })}
    onSourceSelected={(source) => {
      remoteDaemonPathRejection = undefined;
      routeController.edit({ source });
    }}
    onChooseNewFolder={(name) => {
      remoteDaemonPathRejection = undefined;
      routeController.edit({
        source: { kind: 'newFolder', parentPath: $defaultParentPath$, name },
      });
    }}
    onProviderSelected={selectProvider}
    onRecheckCapabilities={() =>
      routeController.dispatch({
        type: 'capabilities.recheckRequested',
        capabilities: ['git', 'node', 'github'],
      })}
    onAddFiles={() => fileInput?.click()}
  />
</div>

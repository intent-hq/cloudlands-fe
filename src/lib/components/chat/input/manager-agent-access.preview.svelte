<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    initializeStore?: boolean;
    role?: 'manager' | 'collaborator';
    initialOpen?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'manager-agent-access',
    title: 'Manager agent and model access',
    defaultState: 'manager',
    states: {
      manager: { props: {} },
      'models-open': { props: { initialOpen: true } },
      participant: { props: { role: 'collaborator' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import CreateAgentSection from '../../workspace/CreateAgentSection.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { selectHidesAgentCreationActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    managerShellWorkspace as workspaceId,
    setManagerShellRole,
  } from '../../terminal/manager-shell-access.preview-fixtures';
  import {
    managerPreviewAgent,
    seedManagerAgentAccess,
    selectManagerPreviewPendingRequests,
  } from './manager-agent-access.preview-fixtures';

  let { role = 'manager', initialOpen = false, initializeStore = false }: Props = $props();
  if (untrack(() => initializeStore)) {
    onDestroy(startRootStoreLifecycle(store, { startSagas: () => [] }));
  }
  seedManagerAgentAccess();
  untrack(() => setManagerShellRole(role));
  $effect(() => setManagerShellRole(role));
  const hidesCreation = selectHidesAgentCreationActions(workspaceId);
  const pendingModelRequests = selectManagerPreviewPendingRequests();
  let createRequests = $state(0);
  let selectedModel = $state('codex-balanced');
  let selectedProvider = $state('codex');
  let picker: ModelPicker;
  onMount(() => {
    let mounted = true;
    if (initialOpen)
      void tick().then(() => {
        if (mounted) picker.open();
      });
    return () => {
      mounted = false;
    };
  });
</script>

<div
  class="min-h-[460px] w-full bg-background text-foreground"
  data-testid="manager-agent-access"
  data-create-requests={createRequests}
  data-model={selectedModel}
  data-provider={selectedProvider}
  data-model-pending={$pendingModelRequests}
>
  <header class="border-b border-border px-4 py-3">
    <h2 class="text-sm font-medium">Intent Site</h2>
    <p class="text-xs text-muted-foreground">
      {role === 'manager' ? 'Manager' : 'Participant'} · Agents
    </p>
  </header>
  <div class="grid grid-cols-1 sm:grid-cols-[240px_minmax(0,1fr)]">
    <section
      aria-label="Workspace agents"
      class="border-b border-border px-3 py-4 sm:border-b-0 sm:border-r"
    >
      {#if !$hidesCreation}
        <CreateAgentSection
          onCreate={() => {
            store.dispatch(createAgentRequested(workspaceId));
            createRequests += 1;
          }}
        />
      {/if}
      <p class="px-3 py-2 text-sm">Website assistant</p>
    </section>
    <section aria-label="Agent model" class="min-w-0 p-4">
      <h3 class="mb-3 text-sm font-medium">Website assistant</h3>
      <ModelPicker
        bind:this={picker}
        {workspaceId}
        agentId={managerPreviewAgent}
        {selectedModel}
        providerId={selectedProvider}
        onModelChange={(model, provider) => {
          selectedModel = model;
          selectedProvider = provider?.providerId ?? selectedProvider;
        }}
        updateGlobalStore={true}
        updateGlobalDefault={false}
        portal={false}
        collisionBoundary="body"
      />
    </section>
  </div>
</div>

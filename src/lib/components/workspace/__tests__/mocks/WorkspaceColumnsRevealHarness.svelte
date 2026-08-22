<script lang="ts">
  import { onMount, type Component } from 'svelte';

  let {
    viewportWidth = 400,
    zoom = 2,
    workspaceKey = 'default',
    standalone = false,
  }: {
    viewportWidth?: number;
    zoom?: number;
    workspaceKey?: string;
    standalone?: boolean;
  } = $props();

  type RuntimeProps = { onReady: () => void; workspaceKey: string; standalone: boolean };
  let Runtime = $state<Component<RuntimeProps> | null>(null);
  let ready = $state(false);
  let initializationError = $state('');

  function formatInitializationError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  function handleInitializationError(error: unknown) {
    const message = formatInitializationError(error);
    queueMicrotask(() => {
      ready = false;
      initializationError = message;
    });
  }

  function handleReady() {
    ready = true;
  }

  onMount(() => {
    let active = true;
    void import('./WorkspaceColumnsRevealRuntime.svelte')
      .then(({ default: RuntimeComponent }) => {
        if (active) Runtime = RuntimeComponent;
      })
      .catch((error: unknown) => {
        if (active) handleInitializationError(error);
      });
    return () => {
      active = false;
    };
  });
</script>

<div
  style:width={`${viewportWidth}px`}
  style:height="520px"
  style:zoom
  data-reveal-host
  data-reveal-ready={ready}
  data-reveal-error={initializationError}
>
  {#if initializationError}
    <output data-reveal-initialization-error>{initializationError}</output>
  {/if}
  {#if Runtime}
    <svelte:boundary onerror={handleInitializationError}>
      {#snippet failed(error: unknown)}
        <output data-reveal-boundary-error>{formatInitializationError(error)}</output>
      {/snippet}
      <Runtime onReady={handleReady} {workspaceKey} {standalone} />
    </svelte:boundary>
  {:else if !initializationError}
    <span data-reveal-initializing></span>
  {/if}
</div>

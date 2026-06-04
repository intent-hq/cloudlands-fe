<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import type { UnifiedAgentConfig } from '$shared/types/agent.types';
  import Button from '$lib/components/ui/button/button.svelte';
  import { store as appStore } from "$store/renderer/store";
  import {
    activateInitialAgentRequested,
    // TODO: InitialAgentActivationStatus was removed in main - this Chief feature needs refactoring
    // type InitialAgentActivationStatus,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  // TODO: selectInitialAgentActivationStatus was removed in main - this Chief feature needs refactoring
  import { selectInitialAgentActivationStatus } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

  type InitialAgentActivationStatus = { status: 'idle' | 'pending' | 'success' | 'failed'; error?: string };

  interface Props {
    step?: string;
    message?: string;
    visible?: boolean;
    workspaceId?: string;
    agentId?: string;
    retryConfig?: UnifiedAgentConfig | null;
  }

  let {
    step = '',
    message = '',
    visible = false,
    workspaceId = '',
    agentId = '',
    retryConfig = null,
  }: Props = $props();

  // Lazy access to dispatch - only called when needed, avoiding Store.init() errors in tests
  const getDispatch = () => appStore.dispatch.bind(appStore);

  // TODO: This Chief feature uses a pattern that was removed in main - needs proper refactoring
  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  const activationStatus$ = selectInitialAgentActivationStatus(workspaceIdStore, agentIdStore);

  let displayedMessage = $state('');
  let showAnimation = $state(false);
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  // Restore activation status tracking (Chief feature - needs refactoring)
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const activationError = $derived(($activationStatus$ as InitialAgentActivationStatus).error);

  function handleRetry() {
    if (!workspaceId || !agentId || !retryConfig) return;
    getDispatch()(activateInitialAgentRequested(workspaceId, agentId, retryConfig));
  }

  onMount(() => {
    return () => {
      if (delayTimer) clearTimeout(delayTimer);
    };
  });

  $effect(() => {
    if (visible && message) {
      // Clear any existing timer
      if (delayTimer) clearTimeout(delayTimer);

      // Add a small delay before showing to avoid flashing
      delayTimer = setTimeout(() => {
        displayedMessage = message;
        showAnimation = true;
        delayTimer = null;
      }, 500);
    } else {
      if (delayTimer) clearTimeout(delayTimer);
      delayTimer = null;
      showAnimation = false;
      displayedMessage = '';
    }
  });
</script>

{#if $activationStatus$.status === 'failed'}
  <div
    role="alert"
    class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
    data-testid="initial-agent-activation-failed"
  >
    <p class="min-w-0 text-destructive-foreground">
      Initial agent failed to start{activationError ? `: ${activationError}` : '.'}
    </p>
    <Button
      variant="outline"
      size="xs"
      onclick={handleRetry}
      disabled={!retryConfig}
      data-testid="initial-agent-activation-retry"
    >
      Retry
    </Button>
  </div>
{:else if showAnimation && displayedMessage}
  <div class="relative overflow-hidden">
    <p class="text-xs text-subtle animate-fade-in">
      {displayedMessage}
    </p>
    {#if step !== 'complete' && step !== 'error'}
      <div class="absolute inset-0 pointer-events-none animate-shimmer shimmer-gradient"></div>
    {/if}
  </div>
{/if}

<style>
  /* Shimmer gradient - uses CSS color-mix that can't be done in Tailwind */
  .shimmer-gradient {
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-sidebar) 60%, transparent),
      transparent
    );
  }
</style>

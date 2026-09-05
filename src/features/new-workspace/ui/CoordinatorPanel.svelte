<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCircleNotch, faPause, faTriangleExclamation } from '$lib/icons/phosphor-icons';
  import ProviderCard from '$features/new-workspace/ui/ProviderCard.svelte';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { CoordinatorPresentation, CoordinatorState } from './types';

  interface Props {
    presentation: CoordinatorPresentation & { state: CoordinatorState };
    onProviderSelected?: (providerId: string) => void;
  }

  let { presentation, onProviderSelected }: Props = $props();

  const description = $derived.by(() => {
    switch (presentation.state) {
      case 'checking':
        return m.newWorkspace_coordinator_checking_description();
      case 'connect-provider':
        return m.newWorkspace_coordinator_connect_description();
      case 'login-required':
        return m.newWorkspace_coordinator_loginRequired_description();
      case 'test-failed':
        return m.newWorkspace_coordinator_testFailed_description();
      case 'ready-idle':
        return m.newWorkspace_coordinator_readyIdle_description();
      case 'message-pending':
        return m.newWorkspace_coordinator_messagePending_description();
      case 'live':
        return m.newWorkspace_coordinator_live_description();
      case 'daemon-offline':
        return m.newWorkspace_coordinator_offline_description();
    }
  });

  const isAlert = $derived(
    presentation.state === 'test-failed' || presentation.state === 'daemon-offline',
  );
</script>

<section
  class="flex min-h-0 flex-col rounded-xl border border-border bg-card"
  data-coordinator-state={presentation.state}
  aria-labelledby="new-workspace-coordinator-title"
>
  <header class="flex items-center gap-3 border-b border-border px-4 py-3">
    <div class="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
      {#if presentation.state === 'checking' || presentation.state === 'message-pending'}
        <Fa icon={faCircleNotch} class="animate-spin motion-reduce:animate-none" />
      {:else if isAlert}
        <Fa icon={faTriangleExclamation} />
      {:else}
        <Fa icon={faPause} />
      {/if}
    </div>
    <div class="min-w-0">
      <h2 id="new-workspace-coordinator-title" class="font-semibold">
        {m.notification_specialist_coordinator()}
      </h2>
      <p class="text-xs text-muted-foreground">{description}</p>
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-auto p-4" role={isAlert ? 'alert' : 'status'}>
    {#if presentation.detail}
      <p class="mb-3 rounded-lg bg-muted p-3 text-sm">{presentation.detail}</p>
    {/if}

    {#if ['connect-provider', 'login-required', 'test-failed'].includes(presentation.state)}
      {#if presentation.provider}
        <div class="mx-auto max-w-64">
          <ProviderCard
            provider={presentation.provider}
            brand={presentation.providerBrand ?? { color1: '#8B8BF8cc', color2: '#8B8BF8' }}
            npxStatus={presentation.npxStatus}
            onSelect={(providerId) => onProviderSelected?.(providerId)}
          />
        </div>
      {/if}
      {#if presentation.deviceFlow}
        <div class="mx-auto mt-4 max-w-sm">
          <GitHubDeviceCodeCard {...presentation.deviceFlow} compact />
        </div>
      {/if}
    {:else if presentation.state === 'ready-idle'}
      <div class="grid min-h-36 place-items-center text-center text-sm text-muted-foreground">
        <p>{m.workspace_phase_planningPlaceholder_subtitle()}</p>
      </div>
    {:else if presentation.state === 'live'}
      <div class="grid min-h-36 place-items-center text-center text-sm text-muted-foreground">
        <p>{m.newWorkspace_coordinator_live_placeholder()}</p>
      </div>
    {/if}
  </div>
</section>

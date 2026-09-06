<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ProviderIcon from '$features/agent/components/AgentProviderIcon.svelte';
  import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
  import { m } from '$shared/paraglide/messages.js';
  import ProviderCard from '$features/new-workspace/ui/ProviderCard.svelte';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import type { CoordinatorPresentation, CoordinatorState } from './types';

  interface Props {
    presentation: CoordinatorPresentation & { state: CoordinatorState };
    onProviderSelected?: (providerId: string) => void;
  }

  let { presentation, onProviderSelected }: Props = $props();

  const providerReady = $derived(
    presentation.provider?.available &&
      !presentation.provider.statusLoading &&
      // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous shared authentication predicate; no data request
      isProviderAuthenticationReady(presentation.provider.id, presentation.provider.authenticated),
  );

  const blocking = $derived(
    ['connect-provider', 'login-required', 'test-failed'].includes(presentation.state),
  );
</script>

{#if blocking}
  <div class="w-full py-2" data-coordinator-state={presentation.state}>
    <p class="type-caption mb-2 text-foreground" role="status">
      {#if presentation.state === 'connect-provider'}
        {m.newWorkspace_coordinator_connect_description()}
      {:else if presentation.state === 'login-required'}
        {m.newWorkspace_coordinator_loginRequired_description()}
      {:else}
        {m.newWorkspace_coordinator_testFailed_description()}
      {/if}
    </p>
    {#if presentation.detail}
      <p class="type-caption mb-3 text-danger" role="alert">{presentation.detail}</p>
    {/if}

    {#if presentation.provider && providerReady}
      <Button
        variant="outline"
        size="sm"
        onclick={() => onProviderSelected?.(presentation.provider!.id)}
      >
        <span aria-hidden="true"><ProviderIcon providerId={presentation.provider.id} /></span>
        {m.workspaceCreation_providerCard_use_ariaLabel({ name: presentation.provider.name })}
      </Button>
    {:else if presentation.provider}
      <div class="max-w-64">
        <ProviderCard
          provider={presentation.provider}
          brand={presentation.providerBrand ?? { color1: '#8B8BF8cc', color2: '#8B8BF8' }}
          npxStatus={presentation.npxStatus}
          onSelect={(providerId) => onProviderSelected?.(providerId)}
        />
      </div>
    {/if}
    {#if presentation.deviceFlow}
      <div class="mt-3 max-w-sm">
        <GitHubDeviceCodeCard {...presentation.deviceFlow} compact />
      </div>
    {/if}
  </div>
{/if}

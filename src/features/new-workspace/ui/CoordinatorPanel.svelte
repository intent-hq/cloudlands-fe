<script lang="ts">
  import ProviderCard from '$features/new-workspace/ui/ProviderCard.svelte';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import type { CoordinatorPresentation, CoordinatorState } from './types';

  interface Props {
    presentation: CoordinatorPresentation & { state: CoordinatorState };
    onProviderSelected?: (providerId: string) => void;
  }

  let { presentation, onProviderSelected }: Props = $props();

  const blocking = $derived(
    ['connect-provider', 'login-required', 'test-failed'].includes(presentation.state),
  );
</script>

{#if blocking}
  <div class="w-full py-2" data-coordinator-state={presentation.state}>
    {#if presentation.detail}
      <p class="type-caption mb-3 text-danger" role="alert">{presentation.detail}</p>
    {/if}

    {#if presentation.provider}
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

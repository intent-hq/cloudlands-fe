<script lang="ts">
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineRowProvider } from './machine-facts';

  let { providers }: { providers: MachineRowProvider[] } = $props();
</script>

{#if providers.length > 0}
  <ul
    class="inline-flex items-center gap-1.5 align-middle"
    aria-label={m.settings_devices_providers_ariaLabel()}
  >
    {#each providers as provider (provider.id)}
      <li class="inline-flex">
        <Tooltip content={provider.name} class="inline-flex">
          <span role="img" aria-label={provider.name} class="inline-flex text-muted-foreground">
            {#if hasProviderIcon(provider.id)}
              <span class="inline-flex" aria-hidden="true">
                <AgentProviderIcon providerId={provider.id} />
              </span>
            {:else}
              <span
                class="inline-flex size-3.5 items-center justify-center rounded-sm bg-muted type-caption leading-none"
                aria-hidden="true">{provider.name.charAt(0).toUpperCase()}</span
              >
            {/if}
          </span>
        </Tooltip>
      </li>
    {/each}
  </ul>
{/if}

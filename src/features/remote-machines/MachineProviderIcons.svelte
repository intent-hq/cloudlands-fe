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
    {#each providers as entry (entry.id)}
      <li class="inline-flex">
        <Tooltip content={entry.name} class="inline-flex">
          <span role="img" aria-label={entry.name} class="inline-flex text-muted-foreground">
            {#if hasProviderIcon(entry.id)}
              <span class="inline-flex" aria-hidden="true">
                <AgentProviderIcon providerId={entry.id} />
              </span>
            {:else}
              <span
                class="inline-flex size-3.5 items-center justify-center rounded-sm bg-muted type-caption leading-none"
                aria-hidden="true">{entry.name.charAt(0).toUpperCase()}</span
              >
            {/if}
          </span>
        </Tooltip>
      </li>
    {/each}
  </ul>
{/if}

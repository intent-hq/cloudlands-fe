<script lang="ts">
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineRowProvider } from './machine-facts';

  let { providers }: { providers: MachineRowProvider[] } = $props();
</script>

{#if providers.length > 0}
  <!-- A thin rule separates the provider group from the platform and version. -->
  <ul
    class="ml-1 inline-flex items-center gap-1.5 border-l border-border pl-2 align-middle"
    aria-label={m.settings_devices_providers_ariaLabel()}
  >
    {#each providers as entry (entry.id)}
      <li class="inline-flex">
        <Tooltip content={entry.name} class="inline-flex">
          <span
            role="img"
            aria-label={entry.name}
            class="inline-flex size-3.5 items-center justify-center text-muted-foreground"
          >
            <span class="inline-flex" aria-hidden="true">
              {#if hasProviderIcon(entry.id)}
                <AgentProviderIcon providerId={entry.id} size={14} monochrome />
              {:else}
                <RobotIcon size={14} />
              {/if}
            </span>
          </span>
        </Tooltip>
      </li>
    {/each}
  </ul>
{/if}

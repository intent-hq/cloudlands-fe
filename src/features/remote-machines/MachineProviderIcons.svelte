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
  <!-- An inline icon group, not a row collection: ListView's roving focus and
       arrow-key handling would fight the Machines list it sits in. A thin rule
       separates it from the platform and version before it in the row meta. -->
  <span
    role="list"
    aria-label={m.settings_devices_providers_ariaLabel()}
    class="ml-1 inline-flex items-center gap-1.5 border-l border-border pl-2 align-middle"
  >
    {#each providers as entry (entry.id)}
      <span role="listitem" class="inline-flex">
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
      </span>
    {/each}
  </span>
{/if}

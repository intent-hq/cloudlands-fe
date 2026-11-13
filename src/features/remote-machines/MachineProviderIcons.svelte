<script lang="ts">
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineRowProvider } from './machine-facts';

  let {
    providers,
    reported = false,
  }: {
    providers: MachineRowProvider[];
    /** The list comes from a report: an empty one says no provider is ready. */
    reported?: boolean;
  } = $props();
</script>

{#if providers.length > 0}
  <!-- An inline icon group, not a row collection: ListView's roving focus and
       arrow-key handling would fight the Machines list it sits in. A thin rule
       separates it from the platform and version before it in the row meta. -->
  <span
    role="list"
    aria-label={m.settings_devices_providers_ariaLabel()}
    class="ml-1 inline-flex items-center gap-1.5 border-l border-border pl-2"
  >
    {#each providers as entry (entry.id)}
      <span role="listitem" class="inline-flex">
        <Tooltip content={entry.name} class="inline-flex">
          <span
            role="img"
            aria-label={entry.name}
            class="inline-flex size-3.5 items-center justify-center text-muted-foreground"
          >
            <!-- Logos fill the centred 14px box; the Auggie logo's negative
                 top margin (a nudge for other contexts) would otherwise
                 stretch it past the box and lift it off centre. -->
            <span class="inline-flex [&_svg]:m-0" aria-hidden="true">
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
{:else if reported}
  <span class="ml-1 border-l border-border pl-2" data-machine-no-providers
    >{m.remoteMachines_noProviders_label()}</span
  >
{/if}

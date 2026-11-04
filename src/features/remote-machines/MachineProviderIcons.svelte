<script lang="ts">
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { ListView } from '$lib/components/patterns/collection';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineRowProvider } from './machine-facts';

  let { providers }: { providers: MachineRowProvider[] } = $props();
</script>

{#if providers.length > 0}
  <!-- Laid out inline: a thin rule separates the provider group from the
       platform and version that precede it in the row meta. -->
  <ListView
    virtualize={false}
    items={providers}
    getKey={(entry) => entry.id}
    getText={(entry) => entry.name}
    ariaLabel={m.settings_devices_providers_ariaLabel()}
    class="ml-1 inline-flex overflow-visible border-l border-border pl-2 align-middle [&>div>div:not([aria-hidden=true])]:flex [&>div>div:not([aria-hidden=true])]:items-center [&>div>div:not([aria-hidden=true])]:gap-1.5 [&>div>div[aria-hidden=true]]:hidden"
  >
    {#snippet row({ item: entry })}
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
    {/snippet}
  </ListView>
{/if}

<script lang="ts">
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import MachinePlatformIcon from './MachinePlatformIcon.svelte';
  import type { MachinePlatform, MachineRowProvider } from './machine-facts';

  let {
    name,
    id,
    platform,
    platformFallback,
    providers,
  }: {
    name: string;
    id?: string;
    platform: MachinePlatform | null;
    platformFallback?: string | null;
    providers: MachineRowProvider[];
  } = $props();
</script>

{#snippet label()}
  <span {id}>{name}</span>
{/snippet}

{#if platform || platformFallback || providers.length > 0}
  <TooltipRich align="start" class="inline rounded-sm focus-visible:-outline-offset-1">
    {#snippet content()}
      <div class="flex flex-col gap-1">
        {#if platform}
          <MachinePlatformIcon {platform} labeled />
        {:else if platformFallback}
          <span>{platformFallback}</span>
        {/if}
        {#if providers.length > 0}
          <div
            role="list"
            aria-label={m.settings_devices_providers_ariaLabel()}
            class="flex flex-wrap gap-x-3 gap-y-1"
          >
            {#each providers as entry (entry.id)}
              <span role="listitem" class="flex min-w-0 items-center gap-2">
                <span
                  class="inline-flex shrink-0 text-muted-foreground [&_svg]:m-0"
                  aria-hidden="true"
                >
                  {#if hasProviderIcon(entry.id)}
                    <AgentProviderIcon providerId={entry.id} size={14} monochrome />
                  {:else}
                    <RobotIcon size={14} />
                  {/if}
                </span>
                <span class="wrap-anywhere">{entry.name}</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/snippet}
    {@render label()}
  </TooltipRich>
{:else}
  {@render label()}
{/if}

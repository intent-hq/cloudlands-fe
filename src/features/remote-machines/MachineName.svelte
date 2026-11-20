<script lang="ts">
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import AgentProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
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

  const providersLabelId = $props.id();
  const hasPlatform = $derived(!!(platform || platformFallback));
</script>

{#snippet label()}
  <span {id}>{name}</span>
{/snippet}

{#if hasPlatform || providers.length > 0}
  <TooltipRich align="start" class="inline rounded-sm focus-visible:-outline-offset-1">
    {#snippet content()}
      <div class="flex flex-col gap-2">
        {#if platform}
          <MachinePlatformIcon {platform} labeled />
        {:else if platformFallback}
          <span>{platformFallback}</span>
        {/if}
        {#if providers.length > 0}
          <div class={cn('flex flex-col gap-1', hasPlatform && 'border-t border-border pt-2')}>
            <span id={providersLabelId} class="text-muted-foreground">
              {m.settings_devices_providers_ariaLabel()}
            </span>
            <div role="list" aria-labelledby={providersLabelId} class="flex flex-col gap-1">
              {#each providers as entry (entry.id)}
                <span role="listitem" class="flex min-w-0 items-start gap-2">
                  <span
                    class="first-line-icon w-3.5 shrink-0 justify-center text-muted-foreground [&_svg]:m-0"
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
          </div>
        {/if}
      </div>
    {/snippet}
    {@render label()}
  </TooltipRich>
{:else}
  {@render label()}
{/if}

<!--
  A machine row's name and its one tooltip: the host-only role, then short
  label/value facts (version, load, operating system, providers). The name
  truncates; the hub marker and the orange version dot after it stay visible.
-->
<script lang="ts">
  import GraphIcon from 'phosphor-svelte/lib/GraphIcon';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import {
    machinePlatformName,
    type MachinePlatform,
    type MachineRowProvider,
  } from './machine-facts';
  import type { MachineFact } from './remote-machines-messages';

  let {
    name,
    id,
    platform,
    platformFallback,
    providers,
    hostOnly = false,
    versionWarning = null,
    facts = [],
    tooltipOpen = false,
  }: {
    name: string;
    id?: string;
    platform: MachinePlatform | null;
    platformFallback?: string | null;
    providers: MachineRowProvider[];
    /** An orchestrator: it runs no agents and sends them to runners. */
    hostOnly?: boolean;
    /** Its intentd is older than this app's: an orange dot after the name (its accessible name). */
    versionWarning?: string | null;
    /** Short facts such as version, agents, CPU and memory, listed before the OS. */
    facts?: MachineFact[];
    /** Previews and tests: show the tooltip without hovering. */
    tooltipOpen?: boolean;
  } = $props();

  const providersLabelId = $props.id();
  const hasPlatform = $derived(!!(platform || platformFallback));
  const hasTooltip = $derived(hostOnly || facts.length > 0 || hasPlatform || providers.length > 0);
</script>

{#snippet dot()}
  <span class="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
{/snippet}

{#snippet label()}
  <span class="flex min-w-0 items-center gap-1.5">
    <span {id} class="min-w-0 truncate">{name}</span>
    {#if hostOnly}
      <span
        role="img"
        aria-label={m.settings_devices_hostOnly_tooltip()}
        data-host-only-marker
        class="inline-flex shrink-0 text-muted-foreground"
      >
        <GraphIcon size={15} aria-hidden="true" />
      </span>
    {/if}
    {#if versionWarning}
      <span
        role="img"
        aria-label={versionWarning}
        data-version-warning
        class="inline-flex shrink-0"
      >
        {@render dot()}
      </span>
    {/if}
  </span>
{/snippet}

{#if hasTooltip}
  <TooltipRich
    open={tooltipOpen}
    align="start"
    class="flex max-w-full min-w-0 rounded-sm focus-visible:-outline-offset-1"
    contentContainerClass="px-4! py-3!"
  >
    {#snippet content()}
      <div class="flex min-w-40 flex-col gap-3" data-machine-tooltip>
        {#if hostOnly}
          <span>{m.settings_devices_hostOnly_tooltip()}</span>
        {/if}
        {#if facts.length > 0 || hasPlatform || providers.length > 0}
          <dl
            class={cn(
              'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3',
              hostOnly && 'border-t border-border pt-3',
            )}
          >
            {#each facts as fact (fact.label)}
              <dt class="text-muted-foreground">{fact.label}</dt>
              <dd
                class={cn('min-w-0 wrap-anywhere', fact.warning && 'text-warning-ink')}
                data-machine-fact={fact.label}
              >
                {fact.value}
              </dd>
            {/each}
            {#if hasPlatform}
              <dt class="text-muted-foreground">{m.settings_devices_operatingSystem_label()}</dt>
              <dd class="min-w-0">{platform ? machinePlatformName(platform) : platformFallback}</dd>
            {/if}
            {#if providers.length > 0}
              <dt id={providersLabelId} class="text-muted-foreground">
                {m.settings_devices_providers_label()}
              </dt>
              <dd
                role="list"
                aria-labelledby={providersLabelId}
                class="flex min-w-0 flex-col gap-0.5"
              >
                {#each providers as entry (entry.id)}
                  <span role="listitem" class="wrap-anywhere">{entry.name}</span>
                {/each}
              </dd>
            {/if}
          </dl>
        {/if}
      </div>
    {/snippet}
    {@render label()}
  </TooltipRich>
{:else}
  {@render label()}
{/if}

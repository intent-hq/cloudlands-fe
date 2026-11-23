<!--
  A machine row's name and its one tooltip: the host-only role, an outdated
  version, load, operating system and providers. The name truncates; the hub
  marker and the orange version dot after it stay visible.
-->
<script lang="ts">
  import GraphIcon from 'phosphor-svelte/lib/GraphIcon';
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
    hostOnly = false,
    versionWarning = null,
    details = [],
  }: {
    name: string;
    id?: string;
    platform: MachinePlatform | null;
    platformFallback?: string | null;
    providers: MachineRowProvider[];
    /** An orchestrator: it runs no agents and sends them to runners. */
    hostOnly?: boolean;
    /** Its intentd is older than this app's: an orange dot after the name. */
    versionWarning?: string | null;
    /** Plain lines such as load, CPU and memory. */
    details?: string[];
  } = $props();

  const providersLabelId = $props.id();
  const hasPlatform = $derived(!!(platform || platformFallback));
  const hasTooltip = $derived(
    hostOnly || !!versionWarning || details.length > 0 || hasPlatform || providers.length > 0,
  );
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
    align="start"
    class="flex max-w-full min-w-0 rounded-sm focus-visible:-outline-offset-1"
    contentContainerClass="px-4! py-3!"
  >
    {#snippet content()}
      <div
        class="flex min-w-36 flex-col gap-3 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-3"
        data-machine-tooltip
      >
        {#if hostOnly || versionWarning}
          <div class="flex flex-col gap-1.5">
            {#if hostOnly}
              <span class="flex items-start gap-2">
                <span class="first-line-icon w-3.5 text-muted-foreground" aria-hidden="true">
                  <GraphIcon size={14} />
                </span>
                <span>{m.settings_devices_hostOnly_tooltip()}</span>
              </span>
            {/if}
            {#if versionWarning}
              <span class="flex items-start gap-2" data-version-warning-detail>
                <span class="first-line-icon w-3.5 justify-center" aria-hidden="true">
                  {@render dot()}
                </span>
                <span>{versionWarning}</span>
              </span>
            {/if}
          </div>
        {/if}
        {#if details.length > 0}
          <div class="flex flex-col gap-0.5" data-machine-details>
            {#each details as line (line)}<span>{line}</span>{/each}
          </div>
        {/if}
        {#if hasPlatform}
          <div class="flex flex-col gap-1.5">
            <span class="type-caption font-medium text-muted-foreground">
              {m.settings_devices_operatingSystem_label()}
            </span>
            {#if platform}
              <MachinePlatformIcon {platform} labeled />
            {:else}
              <span>{platformFallback}</span>
            {/if}
          </div>
        {/if}
        {#if providers.length > 0}
          <div class="flex flex-col gap-1.5">
            <span id={providersLabelId} class="type-caption font-medium text-muted-foreground">
              {m.settings_devices_providers_label()}
            </span>
            <div role="list" aria-labelledby={providersLabelId} class="flex flex-col gap-1.5">
              {#each providers as entry (entry.id)}
                <span role="listitem" class="flex min-w-0 items-start gap-2">
                  <span
                    class="first-line-icon w-3.5 text-muted-foreground [&_svg]:m-0"
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

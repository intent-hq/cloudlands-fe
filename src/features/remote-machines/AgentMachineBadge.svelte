<!--
  Where a remote agent runs. `icon` (agent rows): a monitor icon with the
  machine and platform in its tooltip. `pill` (panel header chip): the icon and
  the machine name. An amber dot means the machine can't be reached, a red dot
  that it revoked access; the state is also named in the tooltip and label.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { Badge } from '$lib/components/ui/badge';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { faDesktop } from '$lib/icons/phosphor-icons';
  import { agentMachineTooltip, type AgentMachineLocation } from './agent-location';

  interface Props {
    location: AgentMachineLocation;
    variant?: 'icon' | 'pill';
  }

  let { location, variant = 'icon' }: Props = $props();

  const tooltip = $derived(agentMachineTooltip(location));
  const dotClass = $derived(
    location.state === 'unreachable'
      ? 'bg-warning'
      : location.state === 'revoked'
        ? 'bg-danger'
        : null,
  );
</script>

<Tooltip content={tooltip} side="bottom" delayDuration={300}>
  {#snippet trigger()}
    {#if variant === 'pill'}
      <span
        class="inline-flex min-w-0 shrink"
        role="img"
        aria-label={tooltip}
        data-agent-machine-badge="pill"
        data-agent-machine-state={location.state}
      >
        <Badge
          size="compact"
          class="h-5 min-w-0 max-w-32 gap-1 bg-muted! font-normal text-muted-foreground"
        >
          {#snippet leadingIcon()}
            <span class="relative inline-flex">
              <Fa icon={faDesktop} class="size-3!" />
              {#if dotClass}
                <span
                  class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-muted {dotClass}"
                  aria-hidden="true"
                ></span>
              {/if}
            </span>
          {/snippet}
          <span class="truncate">{location.name}</span>
        </Badge>
      </span>
    {:else}
      <span
        class="relative inline-flex size-4 shrink-0 items-center justify-center text-subtle"
        role="img"
        aria-label={tooltip}
        data-agent-machine-badge="icon"
        data-agent-machine-state={location.state}
      >
        <Fa icon={faDesktop} class="size-3.5!" />
        {#if dotClass}
          <span
            class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-background {dotClass}"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
    {/if}
  {/snippet}
</Tooltip>

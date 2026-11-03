<!--
  Where a remote agent runs, for agent rows: a monitor icon with the machine and
  platform in its tooltip. An amber dot means the machine can't be reached, a
  red dot that it revoked access; the state is also named in the tooltip and
  label. It sits inside the row button, so it uses a native title (like the
  muted-notifications indicator) rather than an interactive tooltip trigger.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faDesktop } from '$lib/icons/phosphor-icons';
  import { agentMachineTooltip, type AgentMachineLocation } from './agent-location';

  interface Props {
    location: AgentMachineLocation;
  }

  let { location }: Props = $props();

  const tooltip = $derived(agentMachineTooltip(location));
  const dotClass = $derived(
    location.state === 'unreachable'
      ? 'bg-warning'
      : location.state === 'revoked'
        ? 'bg-danger'
        : null,
  );
</script>

<span
  class="relative inline-flex size-4 shrink-0 items-center justify-center text-subtle"
  role="img"
  aria-label={tooltip}
  title={tooltip}
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

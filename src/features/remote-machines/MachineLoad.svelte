<!--
  A runner row's agent count: machine-wide while the runner is connected and
  pushes its load (every host's agents and its own), else this host's agents
  there. The
  tooltip has the agent limit and the whole computer's CPU and memory when the
  runner reports them; a runner that reports them shows its count even at 0, so
  the tooltip is reachable. Nothing otherwise (an older runner with no agents).
-->
<script lang="ts">
  import { Tooltip } from '$lib/components/ui/tooltip';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { machineRowLoad, machineRowResources } from './machine-facts';
  import { machineLoadDetails, runningAgentsLabel } from './remote-machines-messages';

  let {
    machine,
    tooltipOpen = false,
    tooltip = true,
  }: {
    machine: RemoteMachine;
    /** Tests and previews: show the tooltip without hovering. */
    tooltipOpen?: boolean;
    /** Off in machine rows: the name's tooltip carries these lines. */
    tooltip?: boolean;
  } = $props();

  const load = $derived(machineRowLoad(machine));
  const resources = $derived(machineRowResources(machine));
  const running = $derived(load ? load.runningAgents : machine.runningAgents);
  const lines = $derived(tooltip ? machineLoadDetails(machine) : []);
</script>

{#snippet details()}
  <span class="flex flex-col gap-0.5" data-machine-load-tooltip>
    {#each lines as line (line)}<span>{line}</span>{/each}
  </span>
{/snippet}

{#if running > 0 || resources}
  {#if lines.length > 0}
    <Tooltip content={details} open={tooltipOpen}>
      <span data-machine-load={running}>{runningAgentsLabel(running)}</span>
    </Tooltip>
  {:else}
    <span data-machine-load={running}>{runningAgentsLabel(running)}</span>
  {/if}
{/if}

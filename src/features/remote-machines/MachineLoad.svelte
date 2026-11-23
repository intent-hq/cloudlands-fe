<!--
  A runner row's agent count: machine-wide while the runner is connected and
  pushes its load (every host's agents and its own), else this host's agents
  there. A runner that reports CPU and memory shows its count even at 0. The
  limit, CPU and memory are facts in the row's name tooltip.
-->
<script lang="ts">
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { machineRowLoad, machineRowResources } from './machine-facts';
  import { runningAgentsLabel } from './remote-machines-messages';

  let { machine }: { machine: RemoteMachine } = $props();

  const load = $derived(machineRowLoad(machine));
  const resources = $derived(machineRowResources(machine));
  const running = $derived(load ? load.runningAgents : machine.runningAgents);
</script>

{#if running > 0 || resources}
  <span data-machine-load={running}>{runningAgentsLabel(running)}</span>
{/if}

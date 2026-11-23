<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { RemoteMachine } from '$shared/types/remote-machines';

  const GIB = 1024 ** 3;
  const runner = (overrides: Partial<RemoteMachine>): RemoteMachine => ({
    id: 'd-studio-mac',
    name: 'Studio Mac',
    hosts: [],
    port: 5179,
    fingerprint: 'AA:BB',
    state: 'connected',
    runningAgents: 1,
    addedAt: '2026-10-30T00:00:00Z',
    ...overrides,
  });
  const BUSY = runner({
    capabilities: {
      providers: [],
      capacity: { runningAgents: 4, agentCap: 8 },
      resources: { cpuPercent: 35, memoryUsedBytes: 12 * GIB, memoryTotalBytes: 32 * GIB },
    },
  });
  const IDLE = runner({
    runningAgents: 0,
    capabilities: {
      providers: [],
      capacity: { runningAgents: 0, agentCap: 4 },
      resources: { cpuPercent: 3, memoryUsedBytes: 5 * GIB, memoryTotalBytes: 16 * GIB },
    },
  });
  // An older runner: it does not push its count, so the row shows this
  // host's agents there and the tooltip has no load facts.
  const OLDER = runner({
    capabilities: { providers: [], capacity: { runningAgents: 2, agentCap: 4 } },
  });

  export const preview = definePreview({
    id: 'machine-load',
    title: "A runner row's agent count, with agents, CPU and memory in its name tooltip",
    defaultState: 'busy',
    states: {
      busy: { props: { machine: BUSY } },
      idle: { props: { machine: IDLE } },
      older: { props: { machine: OLDER } },
    },
    captureReadiness: { selector: '[data-machine-load]' },
  });
</script>

<script lang="ts">
  import MachineLoad from './MachineLoad.svelte';
  import MachineName from './MachineName.svelte';
  import { machineLoadFacts } from './remote-machines-messages';
  let { machine }: { machine: RemoteMachine } = $props();
</script>

<!-- The name tooltip opens above the row, so the row sits low in the frame. -->
<div class="flex h-56 w-full min-w-0 items-end gap-2 bg-background p-6 text-sm text-foreground">
  <MachineName
    name={machine.name}
    platform={null}
    providers={[]}
    facts={machineLoadFacts(machine)}
    tooltipOpen
  />
  <span class="text-muted-foreground"><MachineLoad {machine} /></span>
</div>

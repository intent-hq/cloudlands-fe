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
  // An older runner: count only, no CPU or memory.
  const OLDER = runner({
    capabilities: { providers: [], capacity: { runningAgents: 2, agentCap: 4 } },
  });

  export const preview = definePreview({
    id: 'machine-load',
    title: "A runner row's agent count and its CPU and memory tooltip",
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
  let { machine }: { machine: RemoteMachine } = $props();
</script>

<!-- The tooltip opens above the count, so the count sits low in the frame. -->
<div
  class="flex h-48 w-full min-w-0 items-end justify-center bg-background p-6 text-sm text-foreground"
>
  <span class="text-muted-foreground"><MachineLoad {machine} tooltipOpen /></span>
</div>

<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupMachineOrderFixture as setup,
    type MachineOrderPreviewState,
  } from '../../test/machine-order-preview';
  const state = (name: MachineOrderPreviewState) => ({ props: {}, setup: () => setup(name) });
  export const preview = definePreview({
    id: 'machine-order',
    title: 'One ordered machine list in Settings → Machines (machineOrder: 1)',
    defaultState: 'owner',
    states: {
      owner: state('owner'),
      member: state('member'),
      saving: state('saving'),
      unsupported: state('unsupported'),
      exceptions: state('exceptions'),
      // The backend runs no agents: it reads "Orchestrator — agents run on your machines".
      orchestrator: state('orchestrator'),
    },
    captureReadiness: { selector: '[data-machine-order-section], [data-nodes-section]' },
  });
</script>

<script lang="ts">
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  const connectionId$ = selectCurrentConnectionId();
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  {#if $connectionId$ === 'build-box'}
    <DevicesSettings />
  {/if}
</div>

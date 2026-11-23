<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupMachineOrderFixture as setup,
    type MachineOrderPreviewState,
  } from '../../test/machine-order-preview';
  import { store } from '$store/renderer/store';
  import {
    keychainSyncStateCleared,
    keychainSyncStateReceived,
  } from '$store/renderer/slices/connections/connections-slice';
  const state = (name: MachineOrderPreviewState) => ({ props: {}, setup: () => setup(name) });
  // On a Mac, the Hosts section also shows the iCloud Keychain sync toggle.
  const macState = {
    props: {},
    setup: () => {
      const restore = setup('owner');
      store.dispatch(
        keychainSyncStateReceived({ supported: true, enabled: true, status: { state: 'active' } }),
      );
      return () => {
        store.dispatch(keychainSyncStateCleared());
        restore();
      };
    },
  };
  export const preview = definePreview({
    id: 'machine-order',
    title: 'Hosts and runners in Settings → Machines (machineOrder: 1)',
    defaultState: 'owner',
    states: {
      owner: state('owner'),
      mac: macState,
      member: state('member'),
      saving: state('saving'),
      unsupported: state('unsupported'),
      exceptions: state('exceptions'),
      disconnected: state('disconnected'),
      // The host runs no agents: its row shows the hub marker, and it is not its own runner.
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

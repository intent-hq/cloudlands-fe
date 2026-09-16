<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import {
    keychainSyncStateCleared,
    keychainSyncStateReceived,
  } from '$store/renderer/slices/connections/connections-slice';
  import { selectKeychainSyncState } from '$store/renderer/slices/connections/connections-selectors';

  function setup(supported: boolean) {
    const previous = selectKeychainSyncState.select(appStore.state);
    appStore.dispatch(keychainSyncStateReceived({ supported, enabled: supported, status: null }));
    return () => {
      appStore.dispatch(
        previous === null ? keychainSyncStateCleared() : keychainSyncStateReceived(previous),
      );
    };
  }

  export const preview = definePreview({
    id: 'connect-backend-modal',
    title: 'Add device appearance',
    defaultState: 'icloud',
    states: {
      icloud: { props: {}, setup: () => setup(true) },
      unsupported: { props: {}, setup: () => setup(false) },
    },
  });
</script>

<script lang="ts">
  import ConnectBackendModal from './ConnectBackendModal.svelte';
  import { Button } from '$lib/components/ui/button';

  let open = $state(true);
</script>

<div class="min-h-96 p-4">
  <Button onclick={() => (open = true)}>Open Add device</Button>
  <ConnectBackendModal bind:open />
</div>

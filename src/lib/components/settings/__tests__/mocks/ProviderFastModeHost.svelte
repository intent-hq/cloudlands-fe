<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import { hydrateProviderFastMode } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { onMount } from 'svelte';
  import { setupPreviewProviders } from '../../provider-selector.preview';
  import { setupProviderFastModePreview } from '../../../../../test/provider-fast-mode-preview';
  import ProviderSelector from '../../ProviderSelector.svelte';

  let {
    supported = true,
    rejectWrites = false,
    daemonValue,
  }: { supported?: boolean; rejectWrites?: boolean; daemonValue?: boolean } = $props();
  let ready = $state(false);
  // Test-only input simulates a pushed daemon preference while the menu stays mounted.
  $effect(() => {
    if (daemonValue !== undefined) {
      appStore.dispatch(hydrateProviderFastMode({ codex: daemonValue }, 10));
    }
  });
  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only in-memory catalog, not a domain fetch.
    const restoreProviders = setupPreviewProviders();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only in-memory persistence seam; production saga owns writes.
    const restoreFastMode = setupProviderFastModePreview(supported, rejectWrites);
    ready = true;
    return () => {
      restoreFastMode();
      restoreProviders();
    };
  });
</script>

<div class="w-full max-w-xl bg-background p-6 text-foreground">
  {#if ready}<ProviderSelector />{/if}
</div>

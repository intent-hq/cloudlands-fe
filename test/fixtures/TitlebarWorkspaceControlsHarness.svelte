<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { onDestroy } from 'svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';

  const TooltipProvider = TooltipPrimitive.Provider;
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(openWorkspaceTab('titlebar-test'));
  onDestroy(dispose);
</script>

<TooltipProvider>
  <WindowTitleBar />
</TooltipProvider>

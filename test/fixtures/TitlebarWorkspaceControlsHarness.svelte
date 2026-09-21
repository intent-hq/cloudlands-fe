<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { onDestroy } from 'svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';

  const TooltipProvider = TooltipPrimitive.Provider;
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  // No sagas run here, so settle the window's guest/owner identity the way
  // guestSessionsSaga does outside Electron; otherwise the boot-time
  // collaborator-only default hides WorkspaceRepoLauncher.
  store.dispatch(guestSessionsListUnavailable());
  store.dispatch(openWorkspaceTab('titlebar-test'));
  onDestroy(dispose);
</script>

<TooltipProvider>
  <WindowTitleBar />
</TooltipProvider>

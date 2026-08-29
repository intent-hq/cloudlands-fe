<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import DockRail from '$features/hud/components/DockRail.svelte';
  import { startHudSubscription } from '$features/hud';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';
  import { selectDockWorkspaces } from '$store/renderer/slices/hud/hud-selectors';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { store as appStore } from '$store/renderer/store';

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  appStore.dispatch(loadWorkspacesRequested());
  onDestroy(disposeAppStore);

  const dockWorkspaces$ = selectDockWorkspaces();

  onMount(() => startHudSubscription());
</script>

<DockRail workspaces={$dockWorkspaces$} />

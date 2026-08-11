<script lang="ts">
  import '../app.css';
  import '@fontsource/ia-writer-mono/400.css';
  import '@fontsource/ia-writer-mono/400-italic.css';
  import '@fontsource/ia-writer-mono/700.css';
  import '@fontsource/ia-writer-mono/700-italic.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/400-italic.css';
  import '@fontsource/jetbrains-mono/500.css';
  import '@fontsource/jetbrains-mono/500-italic.css';
  import '@fontsource/jetbrains-mono/700.css';
  import '@fontsource/jetbrains-mono/700-italic.css';
  import '@fontsource/doto/700.css';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import ActionKeyHud from '$features/hardware-console/actions/ActionKeyHud.svelte';
  import { wireSplashGate } from '$features/backend/splash-gate';
  import { store as appStore } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { startAllAppSagas } from '$store/renderer/sagas';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
    attachMouseHistoryNavigation,
    handleHistoryNavigateIpc,
  } from '$lib/utils/history-navigation';
  // Side-effect import: installs bridge-less IPC handlers without running snapshot seeders.
  import '$store/renderer/seeders';

  let { children }: { children?: Snippet } = $props();

  const disposeStore = startRootStoreLifecycle(appStore, {
    startSagas: startAllAppSagas,
  });
  onDestroy(disposeStore);

  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- root DOM splash lifecycle wiring does not own domain state.
    const stopSplashGate = wireSplashGate(document.getElementById('splash'));
    document.getElementById('app-drag-region')?.remove();

    // eslint-disable-next-line intent/no-component-async-data-fetch -- upstream global input listener registration
    const cleanupMouseHistoryNavigation = attachMouseHistoryNavigation(window);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- upstream main-process navigation bridge
    const historyNavigateListenerId = window.electronAPI?.on?.(
      IPC_CHANNELS.APP.HISTORY_NAVIGATE,
      handleHistoryNavigateIpc,
    );

    return () => {
      stopSplashGate();
      cleanupMouseHistoryNavigation();
      if (historyNavigateListenerId) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- paired listener cleanup
        window.electronAPI.offById(IPC_CHANNELS.APP.HISTORY_NAVIGATE, historyNavigateListenerId);
      }
    };
  });
</script>

{@render children?.()}

<!-- Global hardware-console action HUD; product chrome remains scoped to (app). -->
<ActionKeyHud />

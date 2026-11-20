<script lang="ts">
  /**
   * Tab window shell (shared/types/tab-window.ts): the app store and the tab
   * types, without the sidebar, rail and workspace chrome of the (app) group.
   */
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import { configureMonacoWorkers } from '$lib/utils/monaco-workers';
  import { dismissSplashElement } from '$features/backend/splash-gate';
  import '$store/renderer/seeders';
  import { store as appStore } from '$store/renderer/store';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';

  let { children }: { children?: Snippet } = $props();

  // Before the tab renders: its component comes from the tab type registry.
  registerAllTabTypes();

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(disposeAppStore);

  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- route-local DOM splash lifecycle wiring does not own domain state.
    dismissSplashElement(document.getElementById('splash'));
    document.getElementById('app-drag-region')?.remove();
    // File and diff tabs use Monaco.
    configureMonacoWorkers();
  });
</script>

{@render children?.()}

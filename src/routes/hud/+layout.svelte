<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { dismissSplashElement } from '$features/backend/splash-gate';
  import '$store/renderer/seeders';
  import { store as appStore } from '$store/renderer/store';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';

  let { children }: { children?: Snippet } = $props();

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(disposeAppStore);

  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- route-local DOM splash lifecycle wiring does not own domain state.
    dismissSplashElement(document.getElementById('splash'));
    document.getElementById('app-drag-region')?.remove();
  });
</script>

{@render children?.()}

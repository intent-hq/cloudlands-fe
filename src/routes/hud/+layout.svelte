<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import '$store/renderer/seeders';
  import { store as appStore } from '$store/renderer/store';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';

  let { children }: { children?: Snippet } = $props();

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(disposeAppStore);
</script>

{@render children?.()}

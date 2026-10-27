<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import '$store/renderer/seeders';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';
  import { store as appStore } from '$store/renderer/store';
  import AnnotationToolbar from '$features/annotation/components/AnnotationToolbar.svelte';
  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(disposeAppStore);
</script>

<Screen class="h-full w-full bg-transparent">
  <AnnotationToolbar />
</Screen>

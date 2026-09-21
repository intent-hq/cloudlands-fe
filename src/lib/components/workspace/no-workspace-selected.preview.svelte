<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'no-workspace-selected',
    title: 'No workspace selected',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import HomePage from '../../../routes/(app)/+page.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store as appStore } from '$store/renderer/store';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  const dispose = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  appStore.dispatch(setShowCreateModal(false));
  const showCreateModal = selectShowCreateModal();
  onDestroy(dispose);
</script>

<div class="relative h-96 w-full bg-sidebar text-foreground" data-home-empty-preview>
  <HomePage />
  <output class="sr-only" data-create-workspace-requested>{$showCreateModal}</output>
</div>

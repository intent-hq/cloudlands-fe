<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelOpenModeSettings from '../../PanelOpenModeSettings.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { selectPanelColumnCount } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setPanelColumnCount,
    type PanelColumnCount,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  let { initialCount = 1 }: { initialCount?: PanelColumnCount } = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const panelColumnCount$ = selectPanelColumnCount();
  store.dispatch(setPanelColumnCount(initialCount));
  onDestroy(disposeStore);
</script>

<section data-testid="panel-open-mode-settings-host" data-panel-column-count={$panelColumnCount$}>
  <PanelOpenModeSettings />
</section>

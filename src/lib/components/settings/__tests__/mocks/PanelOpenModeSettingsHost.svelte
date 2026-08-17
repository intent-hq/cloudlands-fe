<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelOpenModeSettings from '../../PanelOpenModeSettings.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { selectPanelOpenMode } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setPanelOpenMode } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  let { initialMode = 'normal' }: { initialMode?: 'normal' | 'pin' } = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const panelOpenMode$ = selectPanelOpenMode();
  store.dispatch(setPanelOpenMode(initialMode));
  onDestroy(disposeStore);
</script>

<section data-testid="panel-open-mode-settings-host" data-panel-open-mode={$panelOpenMode$}>
  <PanelOpenModeSettings />
</section>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelOpenModeSettings from '../../PanelOpenModeSettings.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    selectPanelOpenMode,
    selectPanelStackDirection,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setPanelOpenMode,
    setPanelStackDirection,
    type PanelStackDirection,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  let {
    initialMode = 'normal',
    initialDirection = 'right',
  }: { initialMode?: 'normal' | 'pin'; initialDirection?: PanelStackDirection } = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const panelOpenMode$ = selectPanelOpenMode();
  const panelStackDirection$ = selectPanelStackDirection();
  store.dispatch(setPanelOpenMode(initialMode));
  store.dispatch(setPanelStackDirection(initialDirection));
  onDestroy(disposeStore);
</script>

<section
  data-testid="panel-open-mode-settings-host"
  data-panel-open-mode={$panelOpenMode$}
  data-panel-stack-direction={$panelStackDirection$}
>
  <PanelOpenModeSettings />
</section>

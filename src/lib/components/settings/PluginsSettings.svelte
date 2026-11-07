<script lang="ts">
  import { onMount } from 'svelte';
  import PluginList from './plugins/PluginList.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectPlugins,
    selectPluginsSettings,
  } from '$store/renderer/slices/plugins-settings/plugins-settings-selectors';
  import {
    installPlugin,
    loadPlugins,
    togglePlugin,
    uninstallPlugin,
    updatePlugin,
  } from '$store/renderer/slices/plugins-settings/plugins-settings-slice';

  const state$ = selectPluginsSettings();
  const plugins$ = selectPlugins();

  onMount(() => {
    appStore.dispatch(loadPlugins());
  });
</script>

<PluginList
  plugins={$plugins$}
  loading={$state$.loading}
  loadError={$state$.loadError}
  installing={$state$.installing}
  installError={$state$.installError}
  busy={$state$.busy}
  rowError={$state$.rowError}
  onInstall={(source) => appStore.dispatch(installPlugin(source))}
  onToggle={(name, enabled) => appStore.dispatch(togglePlugin(name, enabled))}
  onUpdate={(name) => appStore.dispatch(updatePlugin(name))}
  onUninstall={(name) => appStore.dispatch(uninstallPlugin(name))}
/>

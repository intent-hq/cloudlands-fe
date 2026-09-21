<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    setEnabled,
    setLoading,
    setServers,
  } from '$store/renderer/slices/mcp-settings/mcp-settings-slice';

  export const preview = definePreview({
    id: 'mcp-advanced-editor',
    title: 'MCP advanced editor disclosure',
    defaultState: 'default',
    states: { default: { props: {} } },
  });

  function setupFixture() {
    const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
    store.dispatch(setEnabled(true));
    store.dispatch(setLoading(false));
    store.dispatch(setServers([]));
    return dispose;
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import McpServersSettings from './McpServersSettings.svelte';

  onDestroy(setupFixture());
</script>

<div class="w-full min-w-0 bg-background p-4" data-testid="mcp-advanced-editor">
  <McpServersSettings />
</div>

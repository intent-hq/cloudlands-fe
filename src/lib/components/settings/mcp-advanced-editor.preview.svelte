<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'mcp-advanced-editor',
    title: 'MCP advanced editor disclosure',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import McpServersSettings from './McpServersSettings.svelte';
  import {
    setupMcpSettingsPreview,
    type McpSettingsPreviewOptions,
  } from '../../../test/mcp-settings-preview';

  let props: McpSettingsPreviewOptions = $props();

  onDestroy(untrack(() => setupMcpSettingsPreview(props)));
</script>

<div class="w-full min-w-0 bg-background p-4" data-testid="mcp-advanced-editor">
  <McpServersSettings />
</div>

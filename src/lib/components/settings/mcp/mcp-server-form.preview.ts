import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import McpServerForm from './McpServerForm.svelte';
import { MCP_SERVER_FORM_PREVIEW_FIXTURES } from './mcp-server-form.preview-fixtures';

export const preview = definePreview<ComponentProps<typeof McpServerForm>>({
  id: 'mcp-server-form',
  title: 'MCP server settings form',
  defaultState: 'empty',
  states: Object.fromEntries(
    Object.entries(MCP_SERVER_FORM_PREVIEW_FIXTURES).map(([name, props]) => [name, { props }]),
  ),
});

export default McpServerForm;

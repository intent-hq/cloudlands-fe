import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import McpServerCard from './McpServerCard.svelte';
import type { McpServerWithStatus } from './types';

type Props = ComponentProps<typeof McpServerCard>;

const noop = () => {};
const handlers = {
  onToggle: noop,
  onEdit: noop,
  onDelete: noop,
  onReauthenticate: noop,
  onRestart: noop,
};

const tools = [
  { name: 'search_issues', description: 'Search issues in the tracker.' },
  { name: 'create_issue', description: 'Create an issue.' },
];

const base: McpServerWithStatus = {
  id: 'plugin:acme-review/tracker',
  name: 'acme-review-tracker',
  type: 'http',
  url: 'https://tracker.acme.dev/mcp',
  plugin: 'acme-review',
  status: 'connected',
  tools,
  toolCount: tools.length,
};

function state(server: Partial<McpServerWithStatus>) {
  return { props: { server: { ...base, ...server }, ...handlers } as Props };
}

export const preview = definePreview<Props>({
  id: 'mcp-server-card',
  title: 'MCP server row',
  defaultState: 'plugin',
  states: {
    plugin: state({}),
    'plugin-stdio-disabled': state({
      id: 'plugin:data-tools/warehouse',
      name: 'data-tools-warehouse',
      type: 'stdio',
      command: 'intentd',
      url: undefined,
      plugin: 'data-tools',
      disabled: true,
      status: 'disabled',
      tools: [],
      toolCount: 0,
    }),
    'plugin-needs-sign-in': state({ status: 'auth_required', tools: [], toolCount: 0 }),
    user: state({
      id: 'srv-linear',
      name: 'linear',
      url: 'https://mcp.linear.app/mcp',
      plugin: undefined,
    }),
  },
});

export default McpServerCard;

import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import PluginList from './PluginList.svelte';
import type { PluginInfo } from '$lib/client/live/live-plugins-client';

type Props = ComponentProps<typeof PluginList>;

const noop = () => {};
const handlers = { onInstall: noop, onToggle: noop, onUpdate: noop, onUninstall: noop };

const acme: PluginInfo = {
  name: 'acme-review',
  status: 'ok',
  enabled: true,
  path: '/Users/ada/.intent/plugins/acme-review',
  version: '1.4.0',
  description: 'Code review checklists and the Acme issue tracker.',
  source: 'https://github.com/acme/review-plugin.git',
  sourceKind: 'git',
  skills: ['review', 'triage', 'release-notes'],
  mcpServers: [
    { name: 'tracker', sessionName: 'acme-review-tracker', transport: 'streamable-http' },
    { name: 'search', sessionName: 'acme-review-search', transport: 'stdio' },
  ],
  diagnostics: [],
};

const docs: PluginInfo = {
  name: 'docs.writer',
  status: 'ok',
  enabled: false,
  path: '/Users/ada/.intent/plugins/docs.writer',
  version: '0.2.1',
  description: 'House style for product docs.',
  source: '/Users/ada/src/docs-writer',
  sourceKind: 'path',
  skills: ['style-guide'],
  mcpServers: [],
  diagnostics: [],
};

const warned: PluginInfo = {
  name: 'data-tools',
  status: 'ok',
  enabled: true,
  path: '/Users/ada/.intent/plugins/data-tools',
  version: '2.0.0',
  description: 'Query warehouses from any agent.',
  skills: [],
  mcpServers: [{ name: 'warehouse', sessionName: 'data-tools-warehouse', transport: 'stdio' }],
  diagnostics: [
    'plugin.json: unknown field `commands` ignored',
    'mcp.json: server `legacy`: `url` must use https for non-loopback hosts; skipped',
  ],
};

const invalid: PluginInfo = {
  name: 'broken-plugin',
  status: 'invalid',
  enabled: true,
  path: '/Users/ada/.intent/plugins/broken-plugin',
  error: 'plugin.json: `$schema` is required',
  skills: [],
  mcpServers: [],
  diagnostics: [],
};

const long: PluginInfo = {
  ...acme,
  name: 'a-very-long-plugin-name-that-keeps-going-to-test-truncation.example',
  description:
    'A long description that explains in great detail what this plugin does so the row must truncate it on narrow screens.',
};

const list = [acme, warned, docs, invalid];

function state(props: Partial<Props>) {
  return { props: { plugins: [], ...handlers, ...props } as Props };
}

export const preview = definePreview<Props>({
  id: 'plugin-list',
  title: 'Plugins settings',
  defaultState: 'installed',
  states: {
    installed: state({ plugins: list }),
    empty: state({}),
    loading: state({ loading: true }),
    'load-error': state({ loadError: 'Could not reach the daemon.' }),
    installing: state({ plugins: list, installing: true }),
    'install-error': state({
      plugins: list,
      installError: 'not a valid plugin: plugin.json is missing',
    }),
    'row-error': state({
      plugins: list,
      rowError: { name: 'acme-review', message: 'git clone failed: repository not found' },
    }),
    'long-name': state({ plugins: [long, docs] }),
    many: state({
      plugins: Array.from({ length: 8 }, (_, i) => ({ ...acme, name: `plugin-${i + 1}` })),
    }),
  },
});

export default PluginList;

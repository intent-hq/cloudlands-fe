import type { UiComponentMetadata } from '../component-metadata';
import { switchFixtures } from './switch.fixtures';

export const switchMetadata = {
  id: 'switch',
  source: 'src/lib/components/ui/switch/index.ts',
  publicImport: '$lib/components/ui/switch',
  legacyImports: ['$lib/components/ui/switch/switch.svelte'],
  exports: ['Switch'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/CatalogControls.svelte',
    'src/lib/component-catalog/ChatPolishGeometryControls.svelte',
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/debug/DebugPanel.svelte',
    'src/lib/components/settings/AgentBackendSettings.svelte',
    'src/lib/components/settings/BackendSyncSettings.svelte',
    'src/lib/components/settings/OpenInAppsSettings.svelte',
    'src/lib/components/settings/mcp/McpServerCard.svelte',
    'src/lib/components/workspace/sidebar/McpServersSection.svelte',
    'src/lib/components/workspace/sidebar/MergePanel.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/switch/switch.test.ts',
  removalGate: 'Retain while exported; switch semantics and form behavior tests must pass.',
  dynamicImports: [],
  fixtures: switchFixtures,
} satisfies UiComponentMetadata;

import type { UiComponentMetadata } from '../component-metadata';
import { toggleFixtures } from './toggle.fixtures';

export const toggleCompatibilityModes = {
  group: {
    replacement: '$lib/components/ui/toggle-group',
    callers: [
      { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
      { path: 'src/routes/(app)/settings/+page.svelte', count: 3 },
    ],
    staticUsageCount: 4,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="group" usage counts both reach zero.',
  },
  switch: {
    replacement: '$lib/components/ui/switch',
    callers: [
      { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
      { path: 'src/lib/components/workspace/sidebar/FileChangesSection.svelte', count: 1 },
    ],
    staticUsageCount: 2,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="switch" usage counts both reach zero.',
  },
  indicator: {
    replacement: '$lib/components/ui/switch',
    callers: [
      { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
      { path: 'src/lib/components/settings/AgentFeaturesSettings.svelte', count: 1 },
      { path: 'src/lib/components/settings/GitWorkspaceSettings.svelte', count: 2 },
      { path: 'src/lib/components/settings/HardwareConsoleSettings.svelte', count: 1 },
      { path: 'src/lib/components/settings/McpServersSettings.svelte', count: 1 },
      { path: 'src/lib/components/settings/NotificationSettings.svelte', count: 3 },
      { path: 'src/lib/components/settings/RtkSettings.svelte', count: 1 },
      { path: 'src/lib/components/settings/WebSocketApiSettings.svelte', count: 1 },
      { path: 'src/lib/components/settings/WorkspaceApiSettings.svelte', count: 1 },
    ],
    staticUsageCount: 12,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="indicator" usage counts both reach zero.',
  },
} as const;

export const toggleMetadata = {
  id: 'toggle',
  source: 'src/lib/components/ui/toggle/index.ts',
  publicImport: '$lib/components/ui/toggle',
  legacyImports: ['$lib/components/ui/toggle/toggle.svelte'],
  exports: ['Toggle'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/settings/AgentFeaturesSettings.svelte',
    'src/lib/components/settings/GitWorkspaceSettings.svelte',
    'src/lib/components/settings/HardwareConsoleSettings.svelte',
    'src/lib/components/settings/McpServersSettings.svelte',
    'src/lib/components/settings/NotificationSettings.svelte',
    'src/lib/components/settings/RtkSettings.svelte',
    'src/lib/components/settings/WebSocketApiSettings.svelte',
    'src/lib/components/settings/WorkspaceApiSettings.svelte',
    'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/toggle/toggle.test.ts',
  removalGate: 'Retain canonical aria-pressed Toggle; remove compatibility modes at their gates.',
  dynamicImports: [],
  fixtures: toggleFixtures,
} satisfies UiComponentMetadata;

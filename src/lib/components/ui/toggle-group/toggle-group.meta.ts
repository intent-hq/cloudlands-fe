import type { UiComponentMetadata } from '../component-metadata';
import { toggleGroupFixtures } from './toggle-group.fixtures';

export const toggleGroupMetadata = {
  id: 'toggle-group',
  source: 'src/lib/components/ui/toggle-group/index.ts',
  publicImport: '$lib/components/ui/toggle-group',
  legacyImports: [],
  exports: ['Item', 'Root', 'ToggleGroup', 'ToggleGroupItem'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/features/layout/tab-types/AgentViewSettingsDropdown.svelte',
    'src/features/layout/tab-types/NoteViewSettingsDropdown.svelte',
    'src/lib/component-catalog/CatalogControls.svelte',
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/settings/ColorThemeSettings.svelte',
    'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/toggle-group/toggle-group.test.ts',
  removalGate: 'Retain while exported; single, multiple, and keyboard behavior tests must pass.',
  dynamicImports: [],
  fixtures: toggleGroupFixtures,
} satisfies UiComponentMetadata;

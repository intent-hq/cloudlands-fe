import { parseUiComponentMetadata } from '../component-metadata';
import { labelFixtures } from './label.fixtures';

export const labelMetadata = parseUiComponentMetadata({
  id: 'label',
  source: 'src/lib/components/ui/label/label.svelte',
  publicImport: '$lib/components/ui/label',
  legacyImports: ['$lib/components/ui/label/label.svelte'],
  exports: ['Label', 'labelMetadata'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/debug/DebugPanel.svelte',
    'src/lib/components/settings/DeviceRow.svelte',
    'src/lib/components/ui/settings-field-row/settings-field-row.svelte',
    'src/lib/components/workspace/initializer/AddRemoteSetupModal.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/label/label.test.ts',
  removalGate: 'Retain while exported and association and fixture tests pass.',
  dynamicImports: [],
  fixtures: labelFixtures,
});

import { parseUiComponentMetadata } from '../component-metadata';
import { settingsFieldRowFixtures } from './settings-field-row.fixtures';

export const settingsFieldRowMetadata = parseUiComponentMetadata({
  id: 'settings-field-row',
  source: 'src/lib/components/ui/settings-field-row/settings-field-row.svelte',
  publicImport: '$lib/components/ui/settings-field-row',
  legacyImports: [],
  exports: ['Root', 'SettingsFieldRow', 'settingsFieldRowMetadata'],
  category: 'pattern',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/settings-field-row/settings-field-row.test.ts',
  removalGate:
    'Retain while Settings consumers need persistent field semantics and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: settingsFieldRowFixtures,
});

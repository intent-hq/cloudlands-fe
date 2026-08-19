import { parseUiComponentMetadata } from '../component-metadata';
import { settingsSectionFixtures } from './settings-section.fixtures';

export const settingsSectionMetadata = parseUiComponentMetadata({
  id: 'settings-section',
  source: 'src/lib/components/ui/settings-section/settings-section.svelte',
  publicImport: '$lib/components/ui/settings-section',
  legacyImports: [],
  exports: ['SettingsSection'],
  category: 'pattern',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/settings-section/settings-section.test.ts',
  removalGate:
    'Retain while Settings consumers need section hierarchy and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: settingsSectionFixtures,
});

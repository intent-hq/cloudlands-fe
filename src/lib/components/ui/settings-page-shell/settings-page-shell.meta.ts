import { parseUiComponentMetadata } from '../component-metadata';
import { settingsPageShellFixtures } from './settings-page-shell.fixtures';

export const settingsPageShellMetadata = parseUiComponentMetadata({
  id: 'settings-page-shell',
  source: 'src/lib/components/ui/settings-page-shell/settings-page-shell.svelte',
  publicImport: '$lib/components/ui/settings-page-shell',
  legacyImports: [],
  exports: ['Root', 'SettingsPageShell', 'settingsPageShellFixtures', 'settingsPageShellMetadata'],
  category: 'pattern',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/settings-page-shell/settings-page-shell.test.ts',
  removalGate:
    'Retain while Settings consumers need the shell and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: settingsPageShellFixtures,
});

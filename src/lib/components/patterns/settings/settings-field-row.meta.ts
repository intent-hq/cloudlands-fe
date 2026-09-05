import { parseUiComponentMetadata } from '$lib/components/ui/component-metadata';
import { settingsFieldRowFixtures } from './settings-field-row.fixtures';

export const settingsFieldRowMetadata = parseUiComponentMetadata({
  id: 'settings-field-row',
  source: 'src/lib/components/patterns/settings/SettingsFieldRow.svelte',
  publicImport: '$lib/components/ui/settings-field-row',
  legacyImports: [],
  exports: ['SettingsFieldRow'],
  category: 'pattern',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/patterns/settings/settings-field-row.test.ts',
  removalGate:
    'Retain while Settings consumers need persistent field semantics and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: settingsFieldRowFixtures,
  useWhen: [
    'A manually composed setting needs a persistent label, description, status, error, and control region.',
  ],
  dontUseWhen: [
    'The setting can be represented by defineSettings; use SettingsForm instead of composing a row directly.',
  ],
  replaces: ['Bespoke settings field-row layout and accessibility wiring.'],
});

import { parseUiComponentMetadata } from '$lib/components/ui/component-metadata';
import { settingsSectionFixtures } from './settings-section.fixtures';

export const settingsSectionMetadata = parseUiComponentMetadata({
  id: 'settings-section',
  source: 'src/lib/components/patterns/settings/SettingsSection.svelte',
  publicImport: '$lib/components/ui/settings-section',
  legacyImports: [],
  exports: ['SettingsSection'],
  category: 'pattern',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/patterns/settings/settings-section.test.ts',
  removalGate:
    'Retain while Settings consumers need section hierarchy and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: settingsSectionFixtures,
  useWhen: [
    'A manually composed settings group needs shared heading, description, busy, error, and action semantics.',
  ],
  dontUseWhen: [
    'The section can be represented by defineSettings; use SettingsForm instead of composing it directly.',
  ],
  replaces: ['Bespoke settings section hierarchy and status wiring.'],
});

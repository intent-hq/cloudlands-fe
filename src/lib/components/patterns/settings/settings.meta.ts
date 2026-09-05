import { parsePatternMetadata } from '../pattern-metadata';
import { settingsFixtures } from './settings.fixtures';

export const settingsMetadata = parsePatternMetadata({
  id: 'settings',
  source: 'src/lib/components/patterns/settings/index.ts',
  publicImport: '$lib/components/patterns/settings',
  exports: [
    'SettingsFieldRow',
    'SettingsForm',
    'SettingsPage',
    'SettingsSection',
    'defineSettings',
    'useSettingsSearch',
  ],
  owner: 'design-system',
  fixtures: settingsFixtures,
  useWhen: [
    'Building settings pages from typed switch, select, input, number, path, keybinding, action, or custom entries.',
    'Adding a boolean setting: append one switch object to the schema; do not add row markup.',
  ],
  dontUseWhen: [
    'Building a transactional form whose fields are not application settings; use the Form pattern.',
  ],
  replaces: [
    'Bespoke settings row and section markup.',
    'Direct SettingsFieldRow and SettingsSection composition in product pages.',
  ],
});

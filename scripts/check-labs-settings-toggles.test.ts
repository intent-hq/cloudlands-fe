// @verify-changed-triggers: src/shared/app-settings-schema.ts, src/lib/components/settings/LabsSettings.svelte, scripts/check-labs-settings-toggles.mjs

import { describe, expect, it } from 'vitest';
import {
  HIDDEN_LABS_SETTINGS,
  checkLabsSettingsToggles,
  findLabsSettings,
  findLabsSwitchActions,
  readSources,
} from './check-labs-settings-toggles.mjs';

function definition(path: string, category: string, apply: string) {
  return [
    '  {',
    `    path: '${path}',`,
    `    label: '${path} (Labs)',`,
    "    description: 'Uses {braces} and `${TEMPLATE}` text.',",
    `    category: '${category}',`,
    "    type: 'boolean',",
    "    source: 'local-storage',",
    '    defaultValue: false,',
    `    apply: ${apply},`,
    '  },',
  ];
}

const redux = (action: string) => `{ kind: 'redux-action', action: 'userPreferences/${action}' }`;

const schema = (...definitions: string[][]) =>
  [
    'const APP_SETTING_DEFINITIONS: readonly AppSettingDefinition[] = [',
    ...definitions.flat(),
    '];',
  ].join('\n');

function toggle(id: string, action: string, extra: string[] = []) {
  return [
    '            {',
    "              kind: 'switch',",
    `              id: '${id}',`,
    ...extra.map((line) => `              ${line}`),
    '              get: () => $value$,',
    '              set: (enabled) => {',
    `                appStore.dispatch(${action}(enabled));`,
    '              },',
    '            },',
  ];
}

const page = (...entries: string[][]) =>
  [
    '<script lang="ts">',
    '  const schema = $derived(',
    '    defineSettings({',
    "      sections: [{ id: 'labs', entries: [",
    ...entries.flat(),
    '      ] }],',
    '    }),',
    '  );',
    '</script>',
  ].join('\n');

const tabGroups = definition('labs.tabGroups', 'labs', redux('setLabsTabGroupsEnabled'));
const cloudMachines = definition(
  'labs.cloudMachines',
  'labs',
  redux('setLabsCloudMachinesEnabled'),
);
const theme = definition('theme.pauseAnimations', 'theme', redux('setPauseAnimations'));
const tabGroupsSwitch = toggle('labs-tab-groups', 'setLabsTabGroupsEnabled');

describe('Labs settings toggle guard', () => {
  it('reads only labs schema entries with their apply plan and line', () => {
    const text = schema(theme, tabGroups);
    expect(findLabsSettings(text)).toEqual([
      {
        path: 'labs.tabGroups',
        applyKind: 'redux-action',
        actionCreator: 'setLabsTabGroupsEnabled',
        line: 13,
      },
    ]);
  });

  it('reads the action creators that Labs switches dispatch, and ignores other entries', () => {
    const text = page(
      tabGroupsSwitch,
      toggle('labs-ssh', 'setLabsSshMachineSetupEnabled', ['when: () => desktop,']),
      toggle('labs-link', 'setLabsHiddenEnabled').map((line) =>
        line.replace("kind: 'switch'", "kind: 'link'"),
      ),
    );
    expect([...findLabsSwitchActions(text)]).toEqual([
      'setLabsTabGroupsEnabled',
      'setLabsSshMachineSetupEnabled',
    ]);
  });

  it('passes when every labs schema entry has a Labs switch', () => {
    expect(
      checkLabsSettingsToggles(
        { schema: schema(theme, tabGroups), page: page(tabGroupsSwitch) },
        {},
      ),
    ).toEqual([]);
  });

  it('flags a labs schema entry with no switch and no allowlist reason (E2B cloud machines)', () => {
    const problems = checkLabsSettingsToggles(
      { schema: schema(tabGroups, cloudMachines), page: page(tabGroupsSwitch) },
      {},
    );
    expect(problems).toEqual([
      expect.stringMatching(
        /app-settings-schema\.ts:\d+ labs\.cloudMachines has no switch .*setLabsCloudMachinesEnabled/,
      ),
    ]);
  });

  it('does not count a switch that dispatches a different action', () => {
    const problems = checkLabsSettingsToggles(
      {
        schema: schema(tabGroups),
        page: page(toggle('labs-tab-groups', 'setLabsTabGroupsVisible')),
      },
      {},
    );
    expect(problems).toEqual([expect.stringMatching(/labs\.tabGroups has no switch/)]);
  });

  it('accepts a hidden labs entry with an allowlist reason', () => {
    expect(
      checkLabsSettingsToggles(
        { schema: schema(tabGroups, cloudMachines), page: page(tabGroupsSwitch) },
        { 'labs.cloudMachines': 'Turned on by support only while the backend rollout runs.' },
      ),
    ).toEqual([]);
  });

  it('flags an allowlist entry without a reason', () => {
    expect(
      checkLabsSettingsToggles(
        { schema: schema(tabGroups, cloudMachines), page: page(tabGroupsSwitch) },
        { 'labs.cloudMachines': '  ' },
      ),
    ).toEqual([
      expect.stringMatching(/HIDDEN_LABS_SETTINGS\['labs\.cloudMachines'\] needs a reason/),
    ]);
  });

  it('flags stale allowlist entries', () => {
    expect(
      checkLabsSettingsToggles(
        { schema: schema(tabGroups), page: page(tabGroupsSwitch) },
        {
          'labs.tabGroups': 'Hidden for now.',
          'labs.retired': 'Hidden for now.',
        },
      ),
    ).toEqual([
      expect.stringMatching(/labs\.tabGroups.*has a switch in Settings → Labs/),
      expect.stringMatching(/labs\.retired.*is not a labs schema entry/),
    ]);
  });

  it('flags a labs entry whose apply plan no switch can dispatch', () => {
    const storage = definition(
      'labs.storageOnly',
      'labs',
      "{ kind: 'local-storage-set', key: 'labs:storageOnly' }",
    );
    expect(
      checkLabsSettingsToggles(
        { schema: schema(tabGroups, storage), page: page(tabGroupsSwitch) },
        {},
      ),
    ).toEqual([expect.stringMatching(/labs\.storageOnly applies via local-storage-set/)]);
  });

  it('flags a Labs page the parser cannot read', () => {
    expect(
      checkLabsSettingsToggles({ schema: schema(tabGroups), page: '<SettingsForm />' }, {}),
    ).toContainEqual(expect.stringMatching(/found no switch entries/));
  });

  it('passes on the current schema and Labs page', () => {
    const sources = readSources(process.cwd());
    expect(findLabsSettings(sources.schema).length).toBeGreaterThan(0);
    expect(checkLabsSettingsToggles(sources, HIDDEN_LABS_SETTINGS)).toEqual([]);
  });
});

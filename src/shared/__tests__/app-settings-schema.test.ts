import { describe, expect, it } from 'vitest';
import {
  findAppSettingDefinition,
  formatSettingValue,
  type AppSettingDefinition,
} from '../app-settings-schema';
import { THEME_PRESET_IDS, THEME_PRESET_MANIFEST } from '../theme-presets-manifest';
import { UPDATE_CHANNELS } from '../../features/auto-update/types';

describe('app settings schema', () => {
  it('defines the persisted GitHub link default action choices', () => {
    expect(findAppSettingDefinition('githubLinks.defaultAction')).toMatchObject({
      type: 'enum',
      source: 'local-storage',
      storageKey: 'github-links:defaultAction',
      defaultValue: 'show-choices',
      enumValues: [
        'show-choices',
        'open-in-browser',
        'open-in-app',
        'copy-link',
        'start-workspace',
      ],
      apply: { kind: 'redux-action', action: 'userPreferences/setGithubLinkDefaultAction' },
    });
  });

  it('derives the update channel choices from UPDATE_CHANNELS (including disabled)', () => {
    const definition = findAppSettingDefinition('preferences.updateChannel');

    expect(definition?.type).toBe('enum');
    // Derived, not a parallel hardcoded list: every channel the service
    // accepts — including 'disabled' — is offered and carries a label.
    expect(definition?.enumValues).toEqual(UPDATE_CHANNELS);
    for (const channel of UPDATE_CHANNELS) {
      expect(definition?.enumLabels?.[channel]).toBeTruthy();
    }
    expect(definition?.enumLabels?.disabled).toBe('Disabled');
    expect(definition?.description).toContain('disabled');
  });

  it('defines persisted appearance preferences that default to enabled', () => {
    expect(findAppSettingDefinition('appearance.chatAurora')).toMatchObject({
      category: 'theme',
      type: 'boolean',
      source: 'local-storage',
      storageKey: 'chat:auroraEnabled',
      defaultValue: true,
      apply: { kind: 'redux-action', action: 'userPreferences/setChatAuroraEnabled' },
    });
    expect(findAppSettingDefinition('appearance.shellTransparency')).toMatchObject({
      category: 'theme',
      type: 'boolean',
      source: 'local-storage',
      storageKey: 'appearance:shellTransparencyEnabled',
      defaultValue: true,
      apply: { kind: 'redux-action', action: 'userPreferences/setShellTransparencyEnabled' },
    });
  });

  it('exposes theme preset IDs as enum values', () => {
    const definition = findAppSettingDefinition('theme.activePresetId');

    expect(definition).toBeDefined();
    expect(definition?.type).toBe('enum');
    expect(definition?.defaultValue).toBeNull();
    expect(definition?.nullable).toBe(true);
    expect(definition?.nullLabel).toBe('Default');
    expect(definition?.enumValues).toEqual(THEME_PRESET_IDS);
  });

  it('describes available theme presets from the manifest', () => {
    const definition = findAppSettingDefinition('theme.activePresetId');

    for (const { id, label } of THEME_PRESET_MANIFEST) {
      expect(definition?.description).toContain(`${label} (${id})`);
    }
  });

  it('formats enum values with human-readable labels', () => {
    const definition = findAppSettingDefinition('theme.activePresetId');

    expect(formatSettingValue(definition as AppSettingDefinition, 'dracula')).toBe('Dracula');
    expect(formatSettingValue(definition as AppSettingDefinition, 'custom-id')).toBe('custom-id');
  });

  it('formats nullable empty values with the configured null label', () => {
    const definition = findAppSettingDefinition('theme.activePresetId');

    expect(formatSettingValue(definition as AppSettingDefinition, null)).toBe('Default');
  });

  it('formats non-nullable empty values with the default empty label', () => {
    const definition = findAppSettingDefinition('theme.preference');

    expect(formatSettingValue(definition as AppSettingDefinition, null)).toBe('(none)');
  });

  it('formats booleans, empty values, primitives, and object fallbacks', () => {
    const booleanDefinition = findAppSettingDefinition(
      'workspace.autoCommit',
    ) as AppSettingDefinition;
    const stringDefinition = findAppSettingDefinition('model.default') as AppSettingDefinition;
    const objectDefinition = findAppSettingDefinition('ui.layout') as AppSettingDefinition;

    expect(formatSettingValue(booleanDefinition, true)).toBe('On');
    expect(formatSettingValue(booleanDefinition, false)).toBe('Off');
    expect(formatSettingValue(stringDefinition, null)).toBe('(none)');
    expect(formatSettingValue(stringDefinition, '')).toBe('(none)');
    expect(formatSettingValue(stringDefinition, 'sonnet')).toBe('sonnet');
    expect(formatSettingValue(stringDefinition, 42)).toBe('42');
    expect(formatSettingValue(objectDefinition, { sidebarSide: 'left' })).toBe(
      '{"sidebarSide":"left"}',
    );
  });
});

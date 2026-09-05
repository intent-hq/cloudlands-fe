// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '$lib/components/ui/component-metadata';
import SettingsSectionHarness from './SettingsSectionHarness.svelte';
import { settingsSectionFixtures } from './settings-section.fixtures';
import { settingsSectionMetadata } from './settings-section.meta';

describe('SettingsSection', () => {
  it('associates its heading and adjacent error while exposing busy state', () => {
    const { container, getByRole, getByText } = render(SettingsSectionHarness);
    const section = getByRole('region', { name: 'Notifications' });
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('heading', { level: 2, name: 'Notifications' })).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('Unable to save');
    expect(getByRole('button', { name: 'Reset section' }).dataset.slot).toBe('button');
    expect(getByText('Section fields')).toBeTruthy();
    expect(container.querySelector('[data-slot="settings-section-content"]')).toBeTruthy();
  });

  it('publishes error, busy, compact, and long-content fixtures', () => {
    expect(() => parseUiComponentMetadata(settingsSectionMetadata)).not.toThrow();
    expect(settingsSectionFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'default',
        'error',
        'loading',
        'busy',
        'compact',
        'long-content',
        'editorial-card',
        'mobile-wrapping',
        'zoom-200',
      ]),
    );
  });

  it('publishes composition guidance', () => {
    expect(settingsSectionMetadata.useWhen).toHaveLength(1);
    expect(settingsSectionMetadata.dontUseWhen).toHaveLength(1);
    expect(settingsSectionMetadata.replaces).toHaveLength(1);
  });
});

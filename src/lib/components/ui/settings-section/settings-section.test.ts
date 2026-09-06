// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
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
    expect(getByRole('alert').className).toContain('text-danger');
    expect(getByRole('button', { name: 'Reset section' })).toBeTruthy();
    expect(getByRole('button', { name: 'Reset section' }).dataset.slot).toBe('button');
    expect(getByText('Section fields')).toBeTruthy();
    const content = container.querySelector('[data-slot="settings-section-content"]');
    expect(section.className).not.toContain('border-t');
    expect(getByRole('heading', { level: 2, name: 'Notifications' }).className).toContain(
      'type-title',
    );
    expect(content?.className).toContain('rounded-(--radius-medium)');
    expect(content?.className).toContain('bg-card');
    expect(content?.className).toContain('space-y-1');
    expect(content?.className).toContain('mt-4');
    expect(content?.className).not.toContain('border');
    expect(content?.className).not.toContain('shadow');
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
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
});

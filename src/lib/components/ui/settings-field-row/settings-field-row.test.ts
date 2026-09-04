// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import SettingsFieldRowHarness from './SettingsFieldRowHarness.svelte';
import { settingsFieldRowFixtures } from './settings-field-row.fixtures';
import { settingsFieldRowMetadata } from './settings-field-row.meta';

describe('SettingsFieldRow', () => {
  it('keeps persistent label, description, error, and control semantics adjacent', () => {
    const { container, getByLabelText, getByRole, getByText } = render(SettingsFieldRowHarness);
    expect(getByLabelText('Notification volume').id).toBe('volume-control');
    expect(getByText(/Controls the volume/)).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('valid volume');
    const row = container.querySelector('[data-slot="settings-field-row"]');
    expect(row?.getAttribute('data-disabled')).toBe('true');
    expect(row?.getAttribute('aria-busy')).toBe('true');
    expect(row?.getAttribute('data-orientation')).toBe('stacked');
    expect(row?.className).not.toContain('opacity-60');
    expect(row?.className).toContain('py-3');
    expect(container.querySelector('[data-slot="label"]')?.className).toContain('type-body');
    expect(container.querySelector('[data-slot="input"]')).toBeTruthy();
    expect(getByText(/Controls the volume/).className).toContain('type-body');
    expect(container.querySelector('[data-field-control]')?.className).toContain('max-w-full');
    expect(container.querySelector('[data-field-leading]')).toBeNull();
    expect(getByRole('alert').className).toContain('text-danger');
  });

  it('publishes the complete settings field state matrix', () => {
    expect(() => parseUiComponentMetadata(settingsFieldRowMetadata)).not.toThrow();
    expect(settingsFieldRowFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'default',
        'disabled',
        'invalid',
        'error',
        'loading',
        'busy',
        'long-content',
        'compact',
        'keyboard-focus',
        'reduced-motion',
        'mobile-stacking',
        'zoom-200',
        'status-info',
      ]),
    );
  });
});

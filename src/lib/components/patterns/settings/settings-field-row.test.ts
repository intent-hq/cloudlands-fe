// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '$lib/components/ui/component-metadata';
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
    expect(container.querySelector('[data-slot="input"]')).toBeTruthy();
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

  it('publishes composition guidance', () => {
    expect(settingsFieldRowMetadata.useWhen).toHaveLength(1);
    expect(settingsFieldRowMetadata.dontUseWhen).toHaveLength(1);
    expect(settingsFieldRowMetadata.replaces).toHaveLength(1);
  });
});

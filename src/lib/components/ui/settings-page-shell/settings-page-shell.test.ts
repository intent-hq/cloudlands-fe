// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import SettingsPageShellHarness from './SettingsPageShellHarness.svelte';
import { settingsPageShellFixtures } from './settings-page-shell.fixtures';
import { settingsPageShellMetadata } from './settings-page-shell.meta';

describe('SettingsPageShell', () => {
  it('supports action and href back modes with a shortcut affordance', async () => {
    const { getByLabelText, getByRole, getByText } = render(SettingsPageShellHarness);
    expect(getByRole('heading', { level: 1, name: 'Application settings' })).toBeTruthy();
    expect(getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
    const action = getByRole('button', { name: 'Back to workspace' });
    await fireEvent.click(action);
    expect(getByLabelText('Back action count').textContent).toBe('1');
    const shortcut = getByText('⌘,');
    expect(shortcut.tagName).toBe('KBD');
    expect(shortcut.getAttribute('aria-label')).toBe('Command comma');
    expect(getByRole('link', { name: 'Linked back' }).getAttribute('href')).toBe('/');
    expect(getByRole('button', { name: 'Field control' })).toBeTruthy();
    expect(getByRole('button', { name: 'Field control' }).dataset.slot).toBe('button');
    expect(getByText('Settings footer')).toBeTruthy();
  });

  it('provides a full-height shell with fixed chrome, an independent content scroller, and measures', () => {
    const { container, getByRole } = render(SettingsPageShellHarness);
    const shell = getByRole('region', { name: 'Application settings' });
    const header = shell.querySelector('[data-slot="settings-page-header"]');
    const navigation = shell.querySelector('[data-slot="settings-page-navigation"]');
    const scroller = shell.querySelector('[data-slot="settings-page-content-scroll"]');
    const content = shell.querySelector('[data-slot="settings-page-content"]');
    const footer = shell.querySelector('[data-slot="settings-page-footer"]');
    const headerInner = shell.querySelector('[data-slot="settings-page-header-inner"]');
    const footerInner = shell.querySelector('[data-slot="settings-page-footer-inner"]');
    expect(shell.getAttribute('aria-busy')).toBe('true');
    expect(shell.className).toContain('h-full');
    expect(shell.className).toContain('overflow-hidden');
    expect(header).toBeTruthy();
    expect(navigation?.className).toContain('overflow-x-auto');
    expect(scroller?.className).toContain('overflow-auto');
    expect(content?.getAttribute('data-measure')).toBe('standard');
    expect(headerInner?.getAttribute('data-measure')).toBe('wide');
    expect(footerInner?.getAttribute('data-measure')).toBe('wide');
    expect(footer?.parentElement).toBe(shell);
    expect(header?.className).toContain('border-border');
    expect(header?.className).toContain('bg-card');
    expect(shell.querySelector('h1')?.className).toContain('type-display');
    expect(footer?.className).toContain('bg-card');
    expect(footer?.className).toContain('type-body');
    expect(content?.className).toContain('space-y-10');
    expect(content?.className).toContain('settings-measure-form');
    expect(
      container.querySelector('[aria-label="Linked settings"] [data-measure="wide"]'),
    ).toBeTruthy();
  });

  it('publishes complete catalog metadata', () => {
    expect(() => parseUiComponentMetadata(settingsPageShellMetadata)).not.toThrow();
    expect(settingsPageShellFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'default',
        'loading',
        'long-content',
        'compact',
        'keyboard-focus',
        'back-action',
        'back-href',
        'shortcut',
        'scroll-regions',
        'global-footer',
        'measure-standard',
        'measure-wide',
        'horizontal-overflow',
        'mobile-stacking',
        'zoom-200',
        'stable-header',
        'stable-footer',
      ]),
    );
  });
});

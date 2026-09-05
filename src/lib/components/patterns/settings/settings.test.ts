// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePatternMetadata } from '../pattern-metadata';
import SettingsHarness from './SettingsHarness.svelte';
import { defineSettingsCustomControls } from './schema';
import { settingsMetadata } from './settings.meta';

afterEach(cleanup);

describe('settings pattern', () => {
  it('keeps custom control registration keyed by schema entry id', () => {
    const renderer = () => undefined;
    const controls = defineSettingsCustomControls({ advanced: renderer });

    expect(controls.advanced).toBe(renderer);
  });

  it('maps every schema kind to its control or custom body', () => {
    const { container } = render(SettingsHarness);
    const kinds = [...container.querySelectorAll('[data-settings-control-kind]')].map((node) =>
      node.getAttribute('data-settings-control-kind'),
    );
    expect(kinds).toEqual(['switch', 'select', 'input', 'number', 'path', 'keybinding', 'action']);
    expect(screen.getByRole('switch', { name: 'Enable feature' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Count' })).toBeTruthy();
    expect(screen.getByTestId('complex-custom')).toBeTruthy();
  });

  it('evaluates when visibility reactively', async () => {
    render(SettingsHarness);
    expect(screen.queryByRole('switch', { name: 'Conditional feature' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Reveal condition' }));
    expect(screen.getByRole('switch', { name: 'Conditional feature' })).toBeTruthy();
  });

  it('filters rows and exposes searchable label, description, and feature code text', () => {
    const { container } = render(SettingsHarness, { searchQuery: 'feature.flag' });
    const form = container.querySelector('[data-slot="settings-form"]')!;
    expect(within(form).getByRole('switch', { name: 'Enable feature' })).toBeTruthy();
    expect(form.querySelectorAll('[data-slot="settings-field-row"]')).toHaveLength(1);
    expect(
      form.querySelector('[data-settings-search-text]')?.getAttribute('data-settings-search-text'),
    ).toContain('Enable feature');
    expect(
      form.querySelector('[data-settings-search-text]')?.getAttribute('data-settings-search-text'),
    ).toContain('feature.flag');
  });

  it('integrates section anchors with the active settings sidebar navigation', async () => {
    render(SettingsHarness);
    expect(screen.getByRole('link', { name: 'General settings' }).getAttribute('href')).toBe(
      '#general',
    );
    expect(screen.getByRole('button', { name: 'Display' }).getAttribute('aria-current')).toBe(
      'page',
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('button', { name: 'Setup' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Display' }).hasAttribute('aria-current')).toBe(
      false,
    );
  });

  it('publishes valid pattern metadata including the one-object boolean-setting guidance', () => {
    expect(() => parsePatternMetadata(settingsMetadata)).not.toThrow();
    expect(settingsMetadata.useWhen.join(' ')).toContain('one switch object');
  });
});

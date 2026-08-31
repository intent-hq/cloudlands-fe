/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUT_REGISTRY } from '$lib/utils/shortcuts';
import {
  resetAllShortcutOverrides,
  resetShortcutOverride,
  setShortcutOverride,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    userPreferences: {
      shortcutOverrides: {} as Record<string, string>,
    },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock, createStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createStoreMockModule(
    createAppStoreMock({ state: () => mocks.state, dispatch: mocks.dispatch }),
  );
});

import KeyboardShortcutsSettings from './KeyboardShortcutsSettings.svelte';

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.state.userPreferences.shortcutOverrides = {};
});

afterEach(cleanup);

describe('KeyboardShortcutsSettings', () => {
  it('renders every registry row as a labelled text input in the existing order', () => {
    render(KeyboardShortcutsSettings);

    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs).toHaveLength(SHORTCUT_REGISTRY.length);
    expect(inputs.map((input) => input.value)).toEqual(
      SHORTCUT_REGISTRY.map(({ defaultKey }) => defaultKey),
    );
    expect(inputs.every((input) => input.hasAttribute('data-shortcut-input'))).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Settings' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('normalizes and dispatches valid edits on Enter', async () => {
    render(KeyboardShortcutsSettings);
    const input = screen.getByRole('textbox', { name: 'Settings' }) as HTMLInputElement;

    input.focus();
    await fireEvent.input(input, { target: { value: ' Command + Shift + , ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      setShortcutOverride('global.settings', 'mod+shift+,'),
    );
    expect(input.value).toBe('mod+shift+,');
  });

  it('keeps the last effective binding and shows actionable feedback for invalid edits', async () => {
    mocks.state.userPreferences.shortcutOverrides = { 'global.settings': 'alt+,' };
    render(KeyboardShortcutsSettings);
    const input = screen.getByRole('textbox', { name: 'Settings' }) as HTMLInputElement;

    await fireEvent.input(input, { target: { value: 'mod+' } });
    await fireEvent.blur(input);

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(input.value).toBe('mod+');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Enter one key');

    input.focus();
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('alt+,');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });

  it('shows row reset only for overrides and resets only that shortcut', async () => {
    mocks.state.userPreferences.shortcutOverrides = { 'global.settings': 'alt+,' };
    render(KeyboardShortcutsSettings);

    expect(screen.queryByRole('button', { name: 'Reset Search to default' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Settings to default' }));
    expect(mocks.dispatch).toHaveBeenCalledWith(resetShortcutOverride('global.settings'));
  });

  it('enables Reset all for overrides and dispatches the global reset', async () => {
    mocks.state.userPreferences.shortcutOverrides = {
      'global.settings': 'alt+,',
      'global.search': 'alt+f',
    };
    render(KeyboardShortcutsSettings);

    const resetAll = screen.getByRole('button', { name: 'Reset all' });
    expect((resetAll as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(resetAll);
    expect(mocks.dispatch).toHaveBeenCalledWith(resetAllShortcutOverrides());
  });
});

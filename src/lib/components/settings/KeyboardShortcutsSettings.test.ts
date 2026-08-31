/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatShortcut, SHORTCUT_REGISTRY } from '$lib/utils/shortcuts';
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
  it('renders every registry row with its formatted, platform-aware binding', () => {
    render(KeyboardShortcutsSettings);

    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs).toHaveLength(SHORTCUT_REGISTRY.length);
    expect(inputs.map((input) => input.value)).toEqual(
      SHORTCUT_REGISTRY.map(({ defaultKey }) => formatShortcut(defaultKey)),
    );
    expect(inputs.every((input) => input.hasAttribute('data-shortcut-input'))).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Settings' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enters empty capture mode on focus and captures modifier combinations', async () => {
    render(KeyboardShortcutsSettings);
    const input = screen.getByRole('textbox', { name: 'Settings' }) as HTMLInputElement;

    await fireEvent.focus(input);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Press shortcut');
    await fireEvent.keyDown(input, {
      key: 'P',
      code: 'KeyP',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      setShortcutOverride('global.settings', 'mod+shift+p'),
    );
    expect(input.value).toBe(formatShortcut('mod+shift+p'));
    expect(document.activeElement).not.toBe(input);
  });

  it('retains every key in range and directional rows when captured', async () => {
    render(KeyboardShortcutsSettings);
    const tabs = screen.getByRole('textbox', { name: 'Go to Tab' });
    const panels = screen.getByRole('textbox', { name: 'Navigate Panels' });

    await fireEvent.focus(tabs);
    await fireEvent.keyDown(tabs, { key: '4', code: 'Digit4', altKey: true });
    await fireEvent.focus(panels);
    await fireEvent.keyDown(panels, { key: 'X', code: 'KeyX', ctrlKey: true });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      setShortcutOverride('navigation.go-to-tab', 'alt+1-9'),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      setShortcutOverride('leader.navigate-panels', 'mod+h/j/k/l'),
    );
  });

  it('preserves the last effective binding when capture is cancelled', async () => {
    mocks.state.userPreferences.shortcutOverrides = { 'global.settings': 'alt+,' };
    render(KeyboardShortcutsSettings);
    const input = screen.getByRole('textbox', { name: 'Settings' }) as HTMLInputElement;

    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe(formatShortcut('alt+,'));
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });

  it('ignores unsupported and modifier-only presses without losing the effective binding', async () => {
    render(KeyboardShortcutsSettings);
    const input = screen.getByRole('textbox', { name: 'Settings' }) as HTMLInputElement;

    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    await fireEvent.keyDown(input, { key: 'Dead', code: 'Quote' });
    expect(input.value).toBe('');
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await fireEvent.blur(input);
    expect(input.value).toBe(formatShortcut('mod+,'));
  });

  it('shows row reset only for overrides and resets only that shortcut', async () => {
    mocks.state.userPreferences.shortcutOverrides = { 'global.settings': 'alt+,' };
    render(KeyboardShortcutsSettings);

    expect(screen.queryByRole('button', { name: 'Reset Search to default' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Settings to default' }));
    expect(mocks.dispatch).toHaveBeenCalledWith(resetShortcutOverride('global.settings'));
  });

  it('keeps the reset control in a gutter outside the fixed input column', () => {
    mocks.state.userPreferences.shortcutOverrides = { 'global.settings': 'alt+,' };
    render(KeyboardShortcutsSettings);

    const input = screen.getByRole('textbox', { name: 'Settings' });
    const reset = screen.getByRole('button', { name: 'Reset Settings to default' });
    expect(input.closest('[data-shortcut-entry]')?.className).toContain(
      'grid-cols-[minmax(0,1fr)_9rem]',
    );
    expect(reset.className).toContain('absolute');
    expect(reset.className).toContain('left-full');
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

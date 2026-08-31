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

const hiddenShortcutIds = new Set([
  'chat.focus-input',
  'chat.mention-context',
  'editor.copy',
  'editor.select-all',
  'editor.undo',
  'editor.redo',
  'leader.resize-panels',
]);
const visibleShortcuts = SHORTCUT_REGISTRY.filter(({ id }) => !hiddenShortcutIds.has(id));

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.state.userPreferences.shortcutOverrides = {};
});

afterEach(cleanup);

describe('KeyboardShortcutsSettings', () => {
  it('renders every visible row with its formatted, platform-aware binding', () => {
    render(KeyboardShortcutsSettings);

    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs).toHaveLength(visibleShortcuts.length);
    expect(inputs.map((input) => input.value)).toEqual(
      visibleShortcuts.map(({ defaultKey }) => formatShortcut(defaultKey)),
    );
    expect(inputs.every((input) => input.hasAttribute('data-shortcut-input'))).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset Settings to default' })).toBeNull();
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

  it('keeps range and directional rows visible but prevents capture and row reset', async () => {
    mocks.state.userPreferences.shortcutOverrides = {
      'navigation.go-to-tab': 'alt+1-9',
      'leader.navigate-panels': 'mod+h/j/k/l',
    };
    render(KeyboardShortcutsSettings);
    const tabs = screen.getByRole('textbox', { name: 'Go to Tab' }) as HTMLInputElement;
    const panels = screen.getByRole('textbox', { name: 'Navigate Panels' }) as HTMLInputElement;

    await fireEvent.focus(tabs);
    await fireEvent.keyDown(tabs, { key: '4', code: 'Digit4', altKey: true });
    await fireEvent.focus(panels);
    await fireEvent.keyDown(panels, { key: 'X', code: 'KeyX', ctrlKey: true });

    expect(tabs.value).toBe(formatShortcut('alt+1-9'));
    expect(panels.value).toBe(formatShortcut('mod+h/j/k/l'));
    expect(tabs.placeholder).toBe('');
    expect(panels.placeholder).toBe('');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reset Go to Tab to default' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset Navigate Panels to default' })).toBeNull();
  });

  it('omits shortcuts hidden from Settings', () => {
    render(KeyboardShortcutsSettings);

    for (const label of [
      'Focus input',
      'Mention Context',
      'Copy',
      'Select All',
      'Undo',
      'Redo',
      'Resize Panels',
    ]) {
      expect(screen.queryByRole('textbox', { name: label })).toBeNull();
    }
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

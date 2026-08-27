// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { isMacPlatform } from '$lib/utils/shortcuts';
import KeyboardShortcutsSettings from './KeyboardShortcutsSettings.svelte';
import { keyboardShortcutsSettingsFixture } from './KeyboardShortcutsSettings.fixtures';

afterEach(cleanup);

describe('KeyboardShortcutsSettings', () => {
  it('renders every populated registry category and shortcut in canonical order', () => {
    const { container } = render(KeyboardShortcutsSettings);
    const categories = [...container.querySelectorAll<HTMLElement>('[data-shortcut-category]')];

    expect(keyboardShortcutsSettingsFixture.map(({ id }) => id)).toEqual([
      'global',
      'navigation',
      'chat',
      'editor',
      'panel',
      'leader',
    ]);
    expect(keyboardShortcutsSettingsFixture.map(({ shortcuts }) => shortcuts.length)).toEqual([
      9, 5, 6, 8, 10, 10,
    ]);
    expect(categories.map((category) => category.dataset.shortcutCategory)).toEqual(
      keyboardShortcutsSettingsFixture.map(({ id }) => id),
    );

    for (const [index, expectedCategory] of keyboardShortcutsSettingsFixture.entries()) {
      const category = categories[index];
      if (!category) throw new Error(`Missing rendered shortcut category: ${expectedCategory.id}`);
      expect(within(category).getByRole('heading', { name: expectedCategory.title })).toBeTruthy();

      const shortcuts = [...category.querySelectorAll<HTMLElement>('[data-shortcut-entry]')];
      expect(shortcuts).toHaveLength(expectedCategory.shortcuts.length);
      expect(shortcuts.map((shortcut) => shortcut.querySelector('dt')?.textContent)).toEqual(
        expectedCategory.shortcuts.map(({ label }) => label),
      );
      expect(
        shortcuts.map((shortcut) => shortcut.querySelector('kbd')?.textContent?.trim()),
      ).toEqual(expectedCategory.shortcuts.map(({ display }) => display));
    }
  });

  it('uses platform-aware formatting from the canonical shortcut registry', () => {
    const { container } = render(KeyboardShortcutsSettings);
    const globalShortcuts = keyboardShortcutsSettingsFixture.find(({ id }) => id === 'global')!;
    const settingsShortcut = globalShortcuts.shortcuts.find(({ key }) => key === 'mod+,')!;
    const forceSendShortcut = keyboardShortcutsSettingsFixture
      .find(({ id }) => id === 'chat')!
      .shortcuts.find(({ key }) => key === 'mod+enter')!;

    expect(settingsShortcut.display).toBe(isMacPlatform() ? '⌘,' : 'Ctrl+,');
    expect(forceSendShortcut.display).toBe(isMacPlatform() ? '⌘↵' : 'Ctrl+↵');
    expect([...container.querySelectorAll('kbd')].map((key) => key.textContent?.trim())).toEqual(
      keyboardShortcutsSettingsFixture.flatMap(({ shortcuts }) =>
        shortcuts.map(({ display }) => display),
      ),
    );
  });

  it('exposes the catalog as a read-only definition list without editing affordances', () => {
    const { container } = render(KeyboardShortcutsSettings);

    expect(container.querySelectorAll('dl')).toHaveLength(keyboardShortcutsSettingsFixture.length);
    expect(container.querySelectorAll('kbd')).toHaveLength(
      keyboardShortcutsSettingsFixture.flatMap(({ shortcuts }) => shortcuts).length,
    );
    expect(
      container.querySelector('button, a, input, select, textarea, [contenteditable="true"]'),
    ).toBeNull();
  });
});

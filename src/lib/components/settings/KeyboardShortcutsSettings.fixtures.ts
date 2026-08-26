import { SHORTCUT_CATEGORIES, formatShortcut } from '$lib/utils/shortcuts';

export const keyboardShortcutsSettingsFixture = Object.entries(SHORTCUT_CATEGORIES)
  .filter(([, category]) => category.shortcuts.length > 0)
  .map(([id, category]) => ({
    id,
    title: category.title,
    shortcuts: category.shortcuts.map((shortcut) => ({
      key: shortcut.key,
      label: shortcut.label,
      display: formatShortcut(shortcut.key),
    })),
  }));

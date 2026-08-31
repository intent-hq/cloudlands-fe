import { derived, readable, type Readable } from 'svelte/store';

import { resolveShortcut, type ShortcutId, type ShortcutOverrides } from './shortcut-bindings';
import { store } from '$store/renderer/store';

function shortcutOverrides(): ShortcutOverrides {
  try {
    return store.state.userPreferences?.shortcutOverrides ?? {};
  } catch {
    return {};
  }
}

export function getEffectiveShortcut(id: ShortcutId): string {
  return resolveShortcut(id, shortcutOverrides());
}

export function effectiveShortcutReadable(id: ShortcutId): Readable<string> {
  if (typeof store.getReadableState !== 'function') {
    return readable(getEffectiveShortcut(id));
  }

  try {
    return derived(store.getReadableState(), (state) =>
      resolveShortcut(id, state.userPreferences?.shortcutOverrides ?? {}),
    );
  } catch {
    return readable(getEffectiveShortcut(id));
  }
}

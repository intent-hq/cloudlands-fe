import { resolveShortcut, type ShortcutId } from '$lib/utils/shortcut-bindings';
import { store } from '../store';
import { selectShortcutOverrides } from '../store/user-preferences/user-preferences-selectors';

const selectEffectiveShortcut = store.createSelector((state, id: ShortcutId) =>
  resolveShortcut(id, state.userPreferences ? (selectShortcutOverrides.select(state) ?? {}) : {}),
);

/** Fresh snapshot for editor and keyboard callbacks, including the pre-init default. */
export function getEffectiveShortcut(id: ShortcutId): string {
  try {
    return selectEffectiveShortcut.select(store.state, id);
  } catch {
    return resolveShortcut(id, {});
  }
}

/**
 * Plain-string boundary for React consumers and third-party keyboard APIs.
 * Call during render after the app initializes its ReactStore.
 */
export function useEffectiveShortcut(id: ShortcutId): string {
  return selectEffectiveShortcut.useValue(id);
}

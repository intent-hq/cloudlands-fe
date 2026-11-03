import type { DockShortcutAction } from '../shared/dock-shortcuts';
export const DOCK_GLOBAL_BINDINGS = [
  ['CommandOrControl+Shift+D', 'focus'],
  ['CommandOrControl+Shift+S', 'capture'],
  ['CommandOrControl+Shift+R', 'record'],
  ['CommandOrControl+Shift+A', 'annotate'],
  ['CommandOrControl+Shift+M', 'dictate'],
] as const satisfies readonly (readonly [string, DockShortcutAction])[];
export function createDockShortcutRegistration(
  api: {
    register(key: string, callback: () => void): boolean;
    unregister(key: string): void;
  },
  action: (action: DockShortcutAction) => void,
  unavailable: (key: string) => void,
) {
  const registered = new Set<string>();
  return {
    sync(enabled: boolean) {
      for (const key of registered) api.unregister(key);
      registered.clear();
      if (!enabled) return;
      for (const [key, name] of DOCK_GLOBAL_BINDINGS) {
        try {
          if (api.register(key, () => action(name))) registered.add(key);
          else unavailable(key);
        } catch {
          unavailable(key);
        }
      }
    },
    available(action: DockShortcutAction) {
      const binding = DOCK_GLOBAL_BINDINGS.find((row) => row[1] === action);
      return !!binding && registered.has(binding[0]);
    },
  };
}

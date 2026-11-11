import {
  dockShortcutAccelerator,
  dockShortcutBindings,
  DOCK_SHORTCUT_IDS,
  dockShortcutAction,
  type DockShortcutBindings,
  type DockShortcutIssue,
} from '../shared/dock-shortcut-settings';
import type { DockShortcutAction } from '../shared/dock-shortcuts';
export function createDockShortcutRegistration(
  api: { register(key: string, callback: () => void): boolean; unregister(key: string): void },
  action: (action: DockShortcutAction) => void,
  unavailable: (key: string) => void,
  platform = process.platform,
) {
  let enabled = false,
    suspended = false;
  let bindings = dockShortcutBindings();
  const owned = new Set<string>();
  let blocked = new Set<DockShortcutAction>();
  let active = new Map<string, DockShortcutAction>();
  let issues: DockShortcutIssue[] = [];
  function desired(next: DockShortcutBindings, excluded = blocked) {
    return new Map(
      DOCK_SHORTCUT_IDS.filter((id) => !excluded.has(dockShortcutAction(id))).map((id) => [
        dockShortcutAccelerator(next[dockShortcutAction(id)], platform)!,
        dockShortcutAction(id),
      ]),
    );
  }
  function release(keys: Iterable<string>) {
    for (const key of [...keys]) {
      api.unregister(key);
      owned.delete(key);
    }
  }
  function reserve(next: DockShortcutBindings, excluded = blocked) {
    const added: string[] = [];
    const failures: DockShortcutIssue[] = [];
    for (const [key, name] of desired(next, excluded)) {
      if (owned.has(key)) continue;
      let ok = false;
      try {
        ok = api.register(key, () => {
          const current = active.get(key);
          if (enabled && !suspended && current) action(current);
        });
      } catch {}
      if (ok) {
        owned.add(key);
        added.push(key);
      } else {
        unavailable(key);
        failures.push({ code: 'unavailable', id: `dock.${name}`, key: next[name] });
      }
    }
    return { added, failures };
  }
  function reconcile() {
    if (!enabled || suspended) {
      active.clear();
      release(owned);
      return;
    }
    const result = reserve(bindings);
    issues = result.failures;
    active = desired(bindings);
    release([...owned].filter((key) => !active.has(key)));
  }
  return {
    sync(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      reconcile();
    },
    block(names: DockShortcutAction[]) {
      blocked = new Set(names);
      reconcile();
    },
    suspend(next: boolean) {
      if (suspended === next) return;
      suspended = next;
      reconcile();
    },
    snapshot() {
      return {
        bindings: { ...bindings },
        enabled,
        capturing: suspended,
        issues: [...issues],
        registered: DOCK_SHORTCUT_IDS.map(dockShortcutAction).filter((name) => {
          const key = dockShortcutAccelerator(bindings[name], platform);
          return enabled && !suspended && !!key && owned.has(key);
        }),
      };
    },
    async update(
      next: DockShortcutBindings,
      persist: () => Promise<void>,
      excluded: DockShortcutAction[] = [...blocked],
    ): Promise<DockShortcutIssue[]> {
      const result =
        enabled && !suspended ? reserve(next, new Set(excluded)) : { added: [], failures: [] };
      if (result.failures.length) {
        release(result.added);
        return result.failures;
      }
      try {
        await persist();
      } catch {
        release(result.added);
        return [{ code: 'save-failed' }];
      }
      bindings = { ...next };
      blocked = new Set(excluded);
      issues = [];
      reconcile();
      return [];
    },
    available(name: DockShortcutAction) {
      // Only the global action has a key; menu-only commands are never registered.
      const key = name === 'focus' ? dockShortcutAccelerator(bindings.focus, platform) : null;
      return enabled && !suspended && !!key && owned.has(key);
    },
  };
}

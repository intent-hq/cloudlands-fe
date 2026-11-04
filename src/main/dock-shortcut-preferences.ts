import type { createDockShortcutRegistration } from './dock-shortcut-registration';
import {
  dockBindingIssues,
  dockShortcutBindings,
  dockShortcutAction,
  DOCK_SHORTCUT_IDS,
  isDockShortcutId,
  normalizeDockShortcut,
  type DockShortcutOverrides,
  type DockShortcutSettingsSnapshot,
  type DockShortcutIssue,
} from '../shared/dock-shortcut-settings';
import {
  sanitizeShortcutOverrides,
  SHORTCUT_DEFAULTS,
  type ShortcutOverrides,
} from '../shared/keyboard-shortcut-bindings';
/** Owns accepted preference revisions and serialized registration/persistence transactions. */
export function createDockShortcutPreferences(deps: {
  registrar: ReturnType<typeof createDockShortcutRegistration>;
  read(): Promise<unknown>;
  write(overrides: DockShortcutOverrides): Promise<void>;
  changed(snapshot: DockShortcutSettingsSnapshot): void;
  platform: string;
  additionalIssues?(
    bindings: import('../shared/dock-shortcut-settings').DockShortcutBindings,
  ): DockShortcutIssue[];
}) {
  let overrides: DockShortcutOverrides = {},
    revision = 0,
    loaded = false,
    loadFailed = false;
  let appOverrides: ShortcutOverrides = {},
    lastIssues: DockShortcutIssue[] = [];
  let requestedEnabled = false,
    capturing = false;
  let changes: Promise<unknown> = Promise.resolve();
  function blocking(next = overrides) {
    const bindings = dockShortcutBindings(next);
    return [
      ...dockBindingIssues(bindings, deps.platform, appOverrides),
      ...(deps.additionalIssues?.(bindings) ?? []),
    ];
  }
  function snapshot(): DockShortcutSettingsSnapshot {
    const current = deps.registrar.snapshot();
    return {
      revision,
      enabled: requestedEnabled,
      capturing,
      overrides: { ...overrides },
      registered: current.registered,
      issues: [
        ...new Map(
          [...blocking(), ...current.issues, ...lastIssues].map((issue) => [
            `${issue.code}:${issue.id ?? ''}`,
            issue,
          ]),
        ).values(),
      ],
    };
  }
  function announce() {
    deps.changed(snapshot());
  }
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = changes.then(run);
    changes = next.catch(() => {});
    return next;
  }
  function applyBlocked() {
    deps.registrar.block(
      blocking().flatMap((issue) => (issue.id ? [dockShortcutAction(issue.id)] : [])),
    );
  }
  return {
    snapshot,
    async load() {
      if (loaded) return snapshot();
      try {
        const value = await deps.read();
        if (value !== undefined) {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Invalid saved dock shortcuts');
          for (const [id, key] of Object.entries(value)) {
            if (!isDockShortcutId(id) || typeof key !== 'string' || !normalizeDockShortcut(key))
              throw new Error('Invalid saved dock shortcut');
            const normalized = normalizeDockShortcut(key);
            if (normalized && normalized !== SHORTCUT_DEFAULTS[id]) overrides[id] = normalized;
          }
        }
        await deps.registrar.update(
          dockShortcutBindings(overrides),
          async () => {},
          blocking().flatMap((issue) => (issue.id ? [dockShortcutAction(issue.id)] : [])),
        );
      } catch {
        loadFailed = true;
        lastIssues = [{ code: 'load-failed' }];
      }
      loaded = true;
      announce();
      return snapshot();
    },
    enable(next: boolean) {
      if (requestedEnabled === next) return;
      requestedEnabled = next;
      if (!next) deps.registrar.sync(false);
      else
        void changes.then(() => {
          if (requestedEnabled && !loadFailed) {
            applyBlocked();
            deps.registrar.sync(true);
            if (capturing) deps.registrar.suspend(true);
            announce();
          }
        });
      announce();
    },
    capture(next: boolean) {
      return enqueue(async () => {
        capturing = next;
        deps.registrar.suspend(next);
        announce();
        return snapshot();
      });
    },
    refresh(values: unknown) {
      return enqueue(async () => {
        appOverrides = sanitizeShortcutOverrides(values);
        if (loaded && !loadFailed) applyBlocked();
        announce();
        return snapshot();
      });
    },
    update(request: {
      id?: string;
      key?: string | null;
      resetAll?: boolean;
      expectedRevision: number;
      appOverrides?: unknown;
    }) {
      return enqueue(async () => {
        if (request.expectedRevision !== revision) {
          lastIssues = [{ code: 'stale' }];
          announce();
          return snapshot();
        }
        appOverrides = sanitizeShortcutOverrides(request.appOverrides);
        const next = { ...overrides };
        if (request.resetAll) {
          for (const id of DOCK_SHORTCUT_IDS) delete next[id];
        } else if (request.id && isDockShortcutId(request.id)) {
          const id = request.id;
          if (request.key === null) delete next[id];
          else {
            const key = typeof request.key === 'string' ? normalizeDockShortcut(request.key) : null;
            if (!key) {
              lastIssues = [{ code: 'invalid', id, key: request.key ?? undefined }];
              announce();
              return snapshot();
            }
            if (key === SHORTCUT_DEFAULTS[id]) delete next[id];
            else next[id] = key;
          }
        } else {
          lastIssues = [{ code: 'invalid' }];
          announce();
          return snapshot();
        }
        const problems = blocking(next);
        const rejected = problems.filter(
          (issue) =>
            issue.code === 'duplicate' ||
            issue.code === 'invalid' ||
            (!request.resetAll && issue.id === request.id),
        );
        if (rejected.length) {
          lastIssues = rejected;
          announce();
          return snapshot();
        }
        const failure = await deps.registrar.update(
          dockShortcutBindings(next),
          () => deps.write(next),
          problems.flatMap((issue) => (issue.id ? [dockShortcutAction(issue.id)] : [])),
        );
        if (failure.length) {
          lastIssues = failure;
          announce();
          return snapshot();
        }
        overrides = next;
        revision++;
        loadFailed = false;
        lastIssues = [];
        if (requestedEnabled) deps.registrar.sync(true);
        announce();
        return snapshot();
      });
    },
  };
}

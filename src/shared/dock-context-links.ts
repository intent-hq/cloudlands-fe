/** Canonical linked-context contract. UI owns presentation and its 300 ms reveal delay. */
export interface DockContextPolicy {
  follows: number;
  decision: 'unasked' | 'no' | 'yes';
}
export interface DockLinkedContextSnapshot {
  /** Changes only on context entry or admitted backend/principal lifetime change. */
  contextVersion: string;
  /** Stable observed identity; an external browser URL is not a browser tab-instance ID. */
  identityKey: string;
  identityKind: 'tab' | 'url' | 'app' | 'unknown';
  error?: 'storage-unavailable' | null;
  phase: 'ready' | 'unavailable';
  label: string;
  icon: string | null;
  url: string | null;
  appId: string | null;
  linkable: boolean;
  linkedWorkspaceId: string | null;
  linkKey: string | null;
  linkRevision: number;
  policy: DockContextPolicy;
  dismissed: boolean;
  /** Desktop-app auto-switch policy can be enabled independently of linking. */
  autoSwitchEligible: boolean;
}
export interface DockContextLinkRecord {
  workspaceId: string;
  revision: number;
  policy: DockContextPolicy;
}
export interface DockContextLinkPreferences {
  version: 1;
  links: Record<string, DockContextLinkRecord>;
}

/** Main-verified observation, separate from action/focus requests. */
export interface DockForegroundObservation {
  sequence: number;
  contextVersion: string;
  backendId: string;
  identityKey: string;
  identityKind: DockLinkedContextSnapshot['identityKind'];
  self: boolean;
  appId: string | null;
  appName: string | null;
  url: string | null;
  icon: string | null;
  workspaceId?: string;
  serviceAddress?: string;
}

import { dockLinkKey, type DockShortcutContext } from './dock-shortcuts';

export function dockContextStorageKey(provenance: string): string {
  return `dock-context-links:${provenance}`;
}
export function contextAsShortcut(value: DockForegroundObservation): DockShortcutContext {
  return {
    id: value.contextVersion,
    backendId: value.backendId,
    action: 'focus',
    ...(value.appId ? { appId: value.appId } : {}),
    ...(value.url ? { url: value.url } : {}),
    ...(value.workspaceId ? { workspaceId: value.workspaceId } : {}),
    ...(value.serviceAddress ? { serviceAddress: value.serviceAddress } : {}),
  };
}
function browserApp(appId: string | null): boolean {
  return (
    !!appId &&
    /(?:^|\.)(?:safari(?:technologypreview)?|chrome|chromium|firefox(?:developeredition|nightly)?|brave|arc|dia|edge|edgemac|opera|vivaldi|browser)(?:\.|$)/i.test(
      appId,
    )
  );
}
/** Local preview addresses are ephemeral process/tunnel evidence, never saved port ownership. */
export function defaultDockContextLinkKey(value: DockForegroundObservation): string | null {
  if (value.self) return null;
  const context = contextAsShortcut(value);
  if (value.url) {
    const key = dockLinkKey(context, 'project') ?? dockLinkKey(context, 'url');
    return key && safeSavedKey(key) ? key : null;
  }
  return browserApp(value.appId) ? null : dockLinkKey(context, 'app');
}
function safeSavedKey(key: string): boolean {
  if (key.startsWith('app:')) return key.length > 4 && key.length < 512;
  const kind = key.startsWith('url:') ? 'url' : key.startsWith('project:') ? 'project' : null;
  if (!kind) return false;
  const raw = key.slice(kind.length + 1);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const context: DockShortcutContext = {
      id: 'saved-key',
      backendId: '',
      action: 'focus',
      url: raw,
    };
    if (!dockLinkKey(context, 'url')) return false;
    return kind === 'url' || (!url.search && !url.hash && url.pathname.endsWith('/'));
  } catch {
    return false;
  }
}
export function parseDockContextPreferences(value: unknown): DockContextLinkPreferences {
  const result: DockContextLinkPreferences = { version: 1, links: {} };
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1)
    return result;
  const links = (value as { links?: unknown }).links;
  if (!links || typeof links !== 'object' || Array.isArray(links)) return result;
  for (const [key, item] of Object.entries(links)) {
    if (!safeSavedKey(key) || !item || typeof item !== 'object') continue;
    const row = item as Partial<DockContextLinkRecord>;
    if (
      typeof row.workspaceId !== 'string' ||
      !row.workspaceId ||
      !Number.isSafeInteger(row.revision) ||
      Number(row.revision) < 1 ||
      !row.policy ||
      !Number.isSafeInteger(row.policy.follows) ||
      row.policy.follows < 0 ||
      !['unasked', 'no', 'yes'].includes(row.policy.decision)
    )
      continue;
    result.links[key] = {
      workspaceId: row.workspaceId,
      revision: row.revision!,
      policy: { follows: Math.min(2, row.policy.follows), decision: row.policy.decision },
    };
  }
  return result;
}
/** Match origins and complete path segments; a project never owns a similarly named sibling. */
export function dockContextLinkKeys(
  value: Pick<DockForegroundObservation, 'self' | 'url' | 'appId'>,
  preferences: DockContextLinkPreferences,
): string[] {
  if (value.self) return [];
  const context: DockShortcutContext = {
    id: 'context-link',
    backendId: '',
    action: 'focus',
    ...(value.appId ? { appId: value.appId } : {}),
    ...(value.url ? { url: value.url } : {}),
  };
  const exact = dockLinkKey(context, 'url');
  const keys = Object.keys(preferences.links).filter((key) => {
    if (!safeSavedKey(key)) return false;
    if (value.url) {
      if (key === exact) return true;
      if (!key.startsWith('project:')) return false;
      try {
        const current = new URL(value.url),
          prefix = new URL(key.slice(8));
        return (
          current.origin === prefix.origin &&
          (current.pathname === prefix.pathname.slice(0, -1) ||
            current.pathname.startsWith(prefix.pathname))
        );
      } catch {
        return false;
      }
    }
    return !browserApp(value.appId) && key === dockLinkKey(context, 'app');
  });
  return keys.sort((a, b) => (a === exact ? -1 : b === exact ? 1 : b.length - a.length));
}
export function isDockForegroundObservation(value: unknown): value is DockForegroundObservation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DockForegroundObservation>;
  return (
    Number.isSafeInteger(row.sequence) &&
    Number(row.sequence) > 0 &&
    typeof row.contextVersion === 'string' &&
    !!row.contextVersion &&
    typeof row.backendId === 'string' &&
    typeof row.identityKey === 'string' &&
    ['tab', 'url', 'app', 'unknown'].includes(String(row.identityKind)) &&
    typeof row.self === 'boolean' &&
    [row.appId, row.appName, row.url, row.icon].every(
      (item) => item === null || typeof item === 'string',
    ) &&
    (row.workspaceId === undefined || typeof row.workspaceId === 'string') &&
    (row.serviceAddress === undefined || typeof row.serviceAddress === 'string')
  );
}

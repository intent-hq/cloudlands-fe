/** A single foreground sample, captured before Intent changes focus. */
export interface DockShortcutContext {
  id: string;
  backendId: string;
  action: 'focus' | 'record';
  appId?: string;
  appName?: string;
  title?: string;
  url?: string;
  workspaceId?: string;
  /** Ephemeral main-verified local/tunnel address on this backend. Never persisted. */
  serviceAddress?: string;
}
export interface DockShortcutState {
  context: DockShortcutContext;
  destination: string | null;
  error: string | null;
  authority?: string | null;
  service?: DockServiceOwner;
}
export type DockLinkScope = 'url' | 'project' | 'app';
export function dockLinkKey(context: DockShortcutContext, scope: DockLinkScope): string | null {
  if (scope === 'app') return context.appId ? `app:${context.appId}` : null;
  if (!context.url) return null;
  try {
    const url = new URL(context.url);
    // Never persist a dev server/forward address: process and tunnel reuse changes ownership.
    if (['localhost', '127.0.0.1', '[::1]', 'daemon.localhost'].includes(url.hostname) || url.port)
      return null;
    if (scope === 'project') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname === 'github.com')
        return parts.length >= 2 ? `project:${url.origin}/${parts.slice(0, 2).join('/')}/` : null;
      const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
      return directory.length > 1 ? `project:${url.protocol}//${url.host}${directory}` : null;
    }
    return `url:${url.href}`;
  } catch {
    return null;
  }
}
export function resolveDockDestination(
  context: DockShortcutContext,
  workspaceIds: readonly string[],
  links: Record<string, string>,
): string | null {
  const valid = (id: string | undefined) => (id && workspaceIds.includes(id) ? id : null);
  for (const scope of ['url', 'project'] as const) {
    const key = dockLinkKey(context, scope);
    const id = key && valid(links[key]);
    if (id) return id;
  }
  if (context.url) {
    try {
      const u = new URL(context.url);
      const address = `${u.protocol}//${u.host}${u.pathname}`;
      const scoped = Object.keys(links)
        .filter(
          (key) => key.startsWith('project:') && address.startsWith(key.slice('project:'.length)),
        )
        .sort((a, b) => b.length - a.length);
      for (const key of scoped) {
        const id = valid(links[key]);
        if (id) return id;
      }
      if (u.protocol === 'intent:' && u.hostname === 'local') {
        const match = /^\/workspace\/([^/]+)$/.exec(u.pathname);
        const id = match && valid(decodeURIComponent(match[1]));
        if (id) return id;
      }
    } catch {
      /* Unknown URLs stay unknown. */
    }
  }
  const owned = valid(context.workspaceId);
  if (owned) return owned;
  // A known but unlinked URL must never inherit a broad app default.
  if (context.url) return null;
  const key = dockLinkKey(context, 'app');
  return key ? valid(links[key]) : null;
}

/** Ranking is a hint for the chooser, never permission to guess a destination. */
export function dockCandidateScore(
  context: DockShortcutContext | undefined,
  workspace: {
    branch?: string;
    worktreePath?: string;
    repositoryOwner?: string;
    repositoryName?: string;
  },
): number {
  if (!context?.url) return 0;
  try {
    const url = new URL(context.url);
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== workspace.repositoryOwner || parts[1] !== workspace.repositoryName) return 0;
      return parts[2] === 'tree' && parts.slice(3).join('/') === workspace.branch ? 3 : 1;
    }
    if (url.protocol === 'file:' && context.backendId === 'local' && workspace.worktreePath) {
      const root = workspace.worktreePath.replace(/\/$/, '');
      const path = decodeURIComponent(url.pathname);
      return path === root || path.startsWith(`${root}/`) ? 2 : 0;
    }
  } catch {
    /* No inferred identity from an unparseable address. */
  }
  return 0;
}

export interface DockServiceOwner {
  workspaceId: string;
  scriptId: string;
  backendId: string;
  connection: string;
  runId: string;
  pid: number;
  startedAt: string;
  restartCount: number;
  detectedUrl: string;
}
/** Exact scheme/host/port and segment-bounded path; query/hash do not own a server. */
export function dockServiceUrlMatches(source: string, detected: string): boolean {
  try {
    const a = new URL(source),
      b = new URL(detected);
    const host = (url: URL) =>
      ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname)
        ? 'loopback'
        : url.hostname;
    const root = b.pathname.replace(/\/$/, '');
    return (
      ['http:', 'https:'].includes(a.protocol) &&
      a.protocol === b.protocol &&
      host(a) === host(b) &&
      a.port === b.port &&
      (a.pathname === root || a.pathname.startsWith(`${root}/`))
    );
  } catch {
    return false;
  }
}

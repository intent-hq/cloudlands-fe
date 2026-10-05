import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import type { GitHubAuthStatus } from '../types';

// Bounded cache lifetime so a missed `github:auth-changed` event (or reconnect)
// self-heals on the next read instead of pinning the first snapshot forever
// (intent#5362). Event/reconnect invalidation still refreshes immediately.
export const GITHUB_AUTH_STATUS_TTL_MS = 20_000;

type Entry = {
  cached?: { status: GitHubAuthStatus; at: number };
  pending?: { generation: number; promise: Promise<GitHubAuthStatus> };
  trailing?: Promise<GitHubAuthStatus>;
};
const entries = new Map<string | undefined, Entry>();
let generation = 0;

function eventType(notification: { method: string; params?: unknown }): string | undefined {
  if (notification.method !== 'events.event' || !notification.params) return undefined;
  const params = notification.params as { event?: unknown; type?: unknown };
  const event = params.event && typeof params.event === 'object' ? params.event : params;
  const type = (event as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

export function invalidateGitHubAuthStatus(): void {
  generation += 1;
  for (const entry of entries.values()) entry.cached = undefined;
}

if (typeof onBackendNotification === 'function') {
  onBackendNotification((notification) => {
    if (eventType(notification) === 'github:auth-changed') invalidateGitHubAuthStatus();
  });
}
if (typeof onBackendReconnected === 'function') {
  onBackendReconnected(() => {
    entries.clear();
    invalidateGitHubAuthStatus();
  });
}

function freshCached(entry: Entry): GitHubAuthStatus | undefined {
  if (!entry.cached) return undefined;
  if (Date.now() - entry.cached.at >= GITHUB_AUTH_STATUS_TTL_MS) {
    entry.cached = undefined;
    return undefined;
  }
  return entry.cached.status;
}

export function readGitHubAuthStatus(
  force = false,
  workspaceId?: string,
): Promise<GitHubAuthStatus> {
  const entry = entries.get(workspaceId) ?? {};
  entries.set(workspaceId, entry);
  if (force) invalidateGitHubAuthStatus();
  else {
    const fresh = freshCached(entry);
    if (fresh) return Promise.resolve(fresh);
  }
  if (!force && entry.pending?.generation === generation) return entry.pending.promise;
  if (entry.pending) {
    if (entry.trailing) return entry.trailing;
    const run = entry.pending.promise
      .catch(() => undefined)
      .then(() => {
        if (entry.trailing === run) entry.trailing = undefined;
        return readGitHubAuthStatus(false, workspaceId);
      })
      .finally(() => {
        if (entry.trailing === run) entry.trailing = undefined;
      });
    entry.trailing = run;
    return run;
  }

  const requestGeneration = generation;
  const run = (
    workspaceId === undefined
      ? backendRequest<GitHubAuthStatus>('github.authStatus')
      : backendRequest<GitHubAuthStatus>('github.authStatus', { workspaceId })
  )
    .then((status) => {
      if (requestGeneration === generation) entry.cached = { status, at: Date.now() };
      return status;
    })
    .finally(() => {
      if (entry.pending?.promise === run) entry.pending = undefined;
    });
  entry.pending = { generation: requestGeneration, promise: run };
  return run;
}

export function __resetGitHubAuthStatusForTests(): void {
  entries.clear();
  generation += 1;
}

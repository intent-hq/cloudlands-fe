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

let cached: { status: GitHubAuthStatus; at: number } | undefined;
let pending: { generation: number; promise: Promise<GitHubAuthStatus> } | undefined;
let trailing: Promise<GitHubAuthStatus> | undefined;
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
  cached = undefined;
}

if (typeof onBackendNotification === 'function') {
  onBackendNotification((notification) => {
    if (eventType(notification) === 'github:auth-changed') invalidateGitHubAuthStatus();
  });
}
if (typeof onBackendReconnected === 'function') {
  onBackendReconnected(() => invalidateGitHubAuthStatus());
}

function freshCached(): GitHubAuthStatus | undefined {
  if (!cached) return undefined;
  if (Date.now() - cached.at >= GITHUB_AUTH_STATUS_TTL_MS) {
    cached = undefined;
    return undefined;
  }
  return cached.status;
}

export function readGitHubAuthStatus(force = false): Promise<GitHubAuthStatus> {
  if (force) invalidateGitHubAuthStatus();
  else {
    const fresh = freshCached();
    if (fresh) return Promise.resolve(fresh);
  }
  if (!force && pending?.generation === generation) return pending.promise;
  if (pending) {
    if (trailing) return trailing;
    const run = pending.promise
      .catch(() => undefined)
      .then(() => {
        if (trailing === run) trailing = undefined;
        return readGitHubAuthStatus();
      })
      .finally(() => {
        if (trailing === run) trailing = undefined;
      });
    trailing = run;
    return run;
  }

  const requestGeneration = generation;
  const run = backendRequest<GitHubAuthStatus>('github.authStatus')
    .then((status) => {
      if (requestGeneration === generation) cached = { status, at: Date.now() };
      return status;
    })
    .finally(() => {
      if (pending?.promise === run) pending = undefined;
    });
  pending = { generation: requestGeneration, promise: run };
  return run;
}

export function __resetGitHubAuthStatusForTests(): void {
  cached = undefined;
  pending = undefined;
  trailing = undefined;
  generation += 1;
}

import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import type { GitHubAuthStatus } from '../types';

let cached: GitHubAuthStatus | undefined;
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

export function readGitHubAuthStatus(force = false): Promise<GitHubAuthStatus> {
  if (force) invalidateGitHubAuthStatus();
  else if (cached) return Promise.resolve(cached);
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
      if (requestGeneration === generation) cached = status;
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

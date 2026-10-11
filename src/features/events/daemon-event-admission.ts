import type { AppliedSettingChange } from '$lib/client/settings-types';
import type { WorkspaceEvent } from './types';
function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== 'object') return null;
  // The daemon wraps each domain event in `{ event, subscriptionId? }` per the
  // notification envelope; older paths may send the event flat as `params`.
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

/**
 * Read the wire-level `params.subscriptionId` tag the daemon attaches when
 * fanning a domain event out per matching subscription. Returns `undefined`
 * for flat/legacy envelopes that carry no id (those bypass the scope gate).
 */
function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

export function admittedDaemonEvent(
  method: string,
  params: unknown,
  expectedSubscriptionIds?: string | readonly string[],
): WorkspaceEvent | null {
  if (method !== 'events.event') return null;
  // Fan-out scope gate (see file header): drop notifications delivered through
  // a different subscription on the same socket so chunk-append/queue/idle
  // handlers never apply the same event twice. The saga owns two leases
  // (firehose + scoped file:*), so the gate accepts a set of expected ids; a
  // bare string is still accepted for back-compat with older call sites.
  // Flat/legacy envelopes (no `subscriptionId` on params) always pass.
  const envelopeSubscriptionId = extractSubscriptionId(params);
  if (envelopeSubscriptionId !== undefined) {
    const expected =
      typeof expectedSubscriptionIds === 'string'
        ? [expectedSubscriptionIds]
        : (expectedSubscriptionIds ?? []);
    if (!expected.includes(envelopeSubscriptionId)) return null;
  }
  const event = extractEvent(params);
  if (!event || typeof event !== 'object') return null;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== 'string') return null;

  return event;
}

export function routeSettingsChangedEvent(
  event: WorkspaceEvent,
  onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => void,
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const raw = (data as { changes?: unknown }).changes;
  if (!Array.isArray(raw)) return;
  const changes: AppliedSettingChange[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== 'string' || path.length === 0) continue;
    const value = (entry as { value?: unknown }).value;
    changes.push({ path, value });
  }
  if (changes.length === 0) return;
  const revision = typeof data.revision === 'number' ? data.revision : undefined;
  onSettingsChanges(changes, revision);
}

/** Workspace membership deltas carry their own invalidation, shared by both routers. */
export function workspaceMembershipInvalidated(event: WorkspaceEvent): string | null {
  if (event.type !== 'workspace:updated' || !event.workspaceId) return null;
  const changes = (event.data as { changes?: Record<string, unknown> } | undefined)?.changes;
  return changes?.members === true || changes?.invites === true ? event.workspaceId : null;
}

/** A removal names the affected principal; other members keep their workspace. */
export function isWorkspaceMembershipRemoval(
  raw: Record<string, unknown>,
  principalId: string | null | undefined,
): boolean {
  return (
    typeof raw.removedPrincipalId === 'string' &&
    raw.removedPrincipalId.length > 0 &&
    raw.removedPrincipalId === principalId
  );
}

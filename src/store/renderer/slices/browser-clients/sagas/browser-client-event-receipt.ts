import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { withRecoveryLifetime } from '../../../middlewares/event-recovery';
import { store } from '../../../store';
import {
  fetchWorkspaceBrowserClientRequested,
  refreshLiveClientsRequested,
} from '../browser-clients-slice';

type ReadAction = { type: string; payload: [workspaceId?: string, ...rest: unknown[]] };
const completions = new Map<ReadAction, () => void>();
const queued = new Map<string, ReadAction>();
const started = new WeakSet<object>();
const key = (action: ReadAction) => JSON.stringify([action.type, action.payload[0] ?? null]);

export function isBrowserClientEvent(action: object): boolean {
  return completions.has(action as ReadAction);
}
export function queueBrowserClientEvent(action: ReadAction): void {
  // Saga takers can resume in either order after re-registering. A trigger
  // already started is never the coalescer's replaceable trailing item.
  if (started.has(action)) return;
  const previous = queued.get(key(action));
  // The single-flight lane retains only its latest queued trigger. A replaced
  // trigger never performs work and must not leave ingress waiting forever.
  if (previous) completeBrowserClientEvent(previous);
  queued.set(key(action), action);
}
export function startBrowserClientEvent(action: ReadAction): void {
  started.add(action);
  if (queued.get(key(action)) === action) queued.delete(key(action));
}
export function completeBrowserClientEvent(action: object): void {
  completions.get(action as ReadAction)?.();
  completions.delete(action as ReadAction);
}
export function cancelBrowserClientEvents(workspaceId?: string): void {
  for (const action of completions.keys())
    if (!workspaceId || action.payload[0] === workspaceId) completeBrowserClientEvent(action);
  for (const [id, action] of queued)
    if (!workspaceId || action.payload[0] === workspaceId) queued.delete(id);
}

/** Both read lanes return their actual completion, including a coalesced trigger. */
export async function dispatchBrowserClientEvent(
  workspaceId: string | undefined,
  lifetime: RecoveryLifetime,
  includeRoster = true,
): Promise<void> {
  if (!lifetime.commit(() => undefined)) return;
  const actions: ReadAction[] = [];
  if (includeRoster) actions.push(refreshLiveClientsRequested(workspaceId));
  if (workspaceId) actions.push(fetchWorkspaceBrowserClientRequested(workspaceId));
  await Promise.all(
    actions.map(
      (action) =>
        new Promise<void>((resolve) => {
          completions.set(action, resolve);
          store.dispatch(withRecoveryLifetime(action, lifetime));
        }),
    ),
  );
}

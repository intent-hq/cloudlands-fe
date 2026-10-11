import { workspaceDeleted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { store } from '@/store';
import {
  admittedDaemonEvent,
  routeSettingsChangedEvent,
  workspaceMembershipInvalidated,
  isWorkspaceMembershipRemoval,
} from '../../../../../src/features/events/daemon-event-admission';
import { routeAuthorityEvent } from '../../../../../src/features/events/daemon-authority-events';
import { eventReceived } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  loadWorkspacesRequested,
  refreshWorkspaceMembershipRequested,
  removeWorkspaceEntity,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import type { AppliedSettingChange } from '$lib/client/settings-types';

/** Only the admitted read/authority surface is mounted in this renderer. */
export function routeDaemonEventsNotification(
  method: string,
  params: unknown,
  ids: readonly string[],
  overrides: { onSettingsChanges: (changes: AppliedSettingChange[], revision?: number) => void },
) {
  const event = admittedDaemonEvent(method, params, ids);
  if (!event) return;
  const type = (event as { type: string }).type;
  if (type === 'settings:changed') {
    routeSettingsChangedEvent(event, overrides.onSettingsChanges);
    return;
  }
  if (routeAuthorityEvent(event, store.state, store.dispatch)) return;
  const workspaceId = event.workspaceId;
  if (!workspaceId) return;
  const membership = workspaceMembershipInvalidated(event);
  if (membership) {
    const changes = (event.data as { changes: Record<string, unknown> }).changes;
    if (isWorkspaceMembershipRemoval(changes, store.state.principal.boundPrincipalId)) {
      store.dispatch(workspaceDeleted(membership, [], 'unshared'));
      return;
    }
    store.dispatch(refreshWorkspaceMembershipRequested(membership));
  }
  if (type === 'workspace:deleted') store.dispatch(removeWorkspaceEntity(workspaceId));
  if (type === 'workspace:created' || type === 'workspace:deleted')
    store.dispatch(loadWorkspacesRequested());
  // Domain read owners consume the canonical event action; no stream or navigation owner is installed here.
  store.dispatch(eventReceived(workspaceId, event));
}

export async function refreshDaemonEventsAfterReconnect(): Promise<void> {
  store.dispatch(loadWorkspacesRequested());
}

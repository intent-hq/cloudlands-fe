import type { StoreAction } from '@themislib/themis/types';
import { createDaemonQueueEvents } from '../../../../../src/features/events/daemon-queue-events';
import { queueReads, submissionEvidence } from '@/features/agent/chat-runtime';
import { agentReadOwnership } from '@/features/agent/agent-read-service';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { parseAgentLocks } from '$lib/client/live/backend-agent-lock-reader';
import { setAgentLockState } from '../../../../../src/store/renderer/slices/agent-lock/agent-lock-slice';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { handleCloneProgressEvent } from '../../../../../src/features/events/daemon-workspace-create-progress';
import { workspaceDeleted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { store } from '@/store';
import {
  admittedDaemonEvent,
  routeSettingsChangedEvent,
  workspaceMembershipInvalidated,
  isWorkspaceMembershipRemoval,
} from '../../../../../src/features/events/daemon-event-admission';
import {
  handlePermissionRequestEvent,
  handlePermissionResolvedEvent,
} from '../../../../../src/features/events/daemon-permission-events';
import { routeAuthorityEvent } from '../../../../../src/features/events/daemon-authority-events';
import { eventReceived } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  loadWorkspacesRequested,
  refreshWorkspaceMembershipRequested,
  removeWorkspaceEntity,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import type { AppliedSettingChange } from '$lib/client/settings-types';

const queueEvents = createDaemonQueueEvents({
  dispatch: (action: StoreAction<unknown>) => store.dispatch(action),
  getSessionWorkspace: (id) => store.state.agentSessions.byAgentId[id]?.workspaceId,
  isAgentReadWorkspaceCurrent: (id, wsId) => !!wsId &&
    !!selectAdmittedWorkspaceReadContext.select(store.state, wsId) &&
    store.state.chatState.byAgentId[id]?.trackedWorkspaceId === wsId &&
    agentReadOwnership.isAgentReadWorkspaceCurrent(id, wsId),
  observeSubmissionEvidence: submissionEvidence.observeSubmissionEvidence,
  noteAgentQueueEventSnapshotApplied: queueReads.noteAgentQueueEventSnapshotApplied,
});

/** Admitted read, authority, and permission events share the existing subscription. */
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
  if (
    (type === 'git:clone:progress' || type === 'git:clone:done') &&
    handleCloneProgressEvent(event, type, store.dispatch)
  )
    return;
  const workspaceId = event.workspaceId;
  if (!workspaceId) return;
  if (type === 'agent:queue:updated') queueEvents.handleQueueUpdatedEvent(event);
  if (type === 'agent:queue:processing') queueEvents.handleQueueProcessingEvent(event);
  if (type === 'changes:agent-locks') {
    const data = event.data as { workspaceId?: string };
    const target = data?.workspaceId ?? workspaceId;
    const context = selectGitWriteContext.select(store.state, target);
    if (target !== workspaceId || !context || !store.state.git.byWorkspaceId[target]) return;
    try {
      const locks = parseAgentLocks(data);
      store.dispatch(
        setAgentLockState(target, locks.lockedAgentIds, locks.lockedFilePaths, context, true),
      );
    } catch {
      /* Malformed event cannot grant write admission. */
    }
    return;
  }
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
  if (type === 'agent:permission:request') {
    handlePermissionRequestEvent(event, store.dispatch);
  }
  if (type === 'agent:permission:resolved') {
    handlePermissionResolvedEvent(event, store.dispatch);
  }
  // Permission events also fall through to the canonical timeline action.
  // Domain read owners consume the canonical event action; no stream or navigation owner is installed here.
  store.dispatch(eventReceived(workspaceId, event));
}

export async function refreshDaemonEventsAfterReconnect(): Promise<void> {
  store.dispatch(loadWorkspacesRequested());
}

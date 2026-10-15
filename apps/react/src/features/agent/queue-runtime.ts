import { store } from '@/store';
import { selectChatDraftOwnerView } from '@/store/chat-drafts/chat-drafts-selectors';
import { selectCanAdministerHost } from '@/store/principal/principal-selectors';
import { getPrincipalConnectionContext } from '../../../../../src/store/renderer/slices/principal/principal-context';
import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { getWorkspaceById, getWorkspaceParticipationContext } from '../../../../../src/store/renderer/slices/workspace/workspace-authority-projections';
import { getAgentQueueMessages } from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-projections';
import type { QueuedMessageMutationRequest, QueueRemovalAuthority } from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-types';
import { queuedMessagePermissions } from '$lib/utils/queued-message-permissions';
import { agentReadOwnership } from './agent-read-service';

/** A UI callback captures the existing canonical composer lease before the FIFO. */
export function captureQueueRemovalRequest(agentId: string, workspaceId: string, consumerId: string, messageId: string, view: { lifetime: string; authority: string | null }): QueuedMessageMutationRequest | undefined {
  const owner = selectChatDraftOwnerView.select(store.state, consumerId)?.restore;
  const principalId = getPrincipalSnapshot(store.state)?.principal.id;
  const authority = getPrincipalConnectionContext(store.state);
  const participation = getWorkspaceParticipationContext(store.state, workspaceId);
  if (!owner || owner.requestId !== view.lifetime || authority !== view.authority || owner.status !== 'restored' || owner.agentId !== agentId || owner.workspaceId !== workspaceId || !principalId || !authority || !participation) return;
  const lease = agentReadOwnership.captureAgentMutationOwnership(agentId, workspaceId);
  const request: QueuedMessageMutationRequest = {
    requestId: crypto.randomUUID(), agentId, workspaceId, consumerId, messageId, operation: {kind:'remove'},
    removalBackendId: store.state.connections.windowBackendId,
    removalScope: {agentId, workspaceId, principalId, authority, participation, owner: lease.key, lifetime: owner.requestId},
  };
  return captureQueueRemovalAuthority(request)?.isCurrent() ? request : undefined;
}

/** Captured once at FIFO intake; an old callback can never adopt a remounted composer. */
export function captureQueueRemovalAuthority(request: QueuedMessageMutationRequest): QueueRemovalAuthority | undefined {
  const scope = request.removalScope;
  if (!scope || request.operation.kind !== 'remove') return;
  const lease = agentReadOwnership.captureAgentMutationOwnership(request.agentId, request.workspaceId);
  const current = () => {
    const owner = selectChatDraftOwnerView.select(store.state, request.consumerId)?.restore;
    return !!owner && owner.status === 'restored' && owner.requestId === scope.lifetime &&
      owner.agentId === scope.agentId && owner.workspaceId === scope.workspaceId &&
      scope.agentId === request.agentId && scope.workspaceId === request.workspaceId &&
      scope.owner === lease.key && lease.isCurrent(store.state.agentSessions.byAgentId[request.agentId]?.workspaceId) &&
      request.removalBackendId === store.state.connections.windowBackendId &&
      scope.authority === getPrincipalConnectionContext(store.state) &&
      scope.principalId === getPrincipalSnapshot(store.state)?.principal.id &&
      scope.participation === getWorkspaceParticipationContext(store.state, request.workspaceId);
  };
  if (!current()) return;
  let retired = false;
  const admitted = () => { retired ||= !current(); return !retired; };
  return {
    isCurrent: () => {
      if (!admitted()) return false;
      const row = getAgentQueueMessages(store.state, request.agentId, request.workspaceId).find((item) => item.id === request.messageId);
      // A row that drained needs no write. The worker reports only no-longer-queued.
      return !row || queuedMessagePermissions(row, scope.principalId,
        getWorkspaceById(store.state, request.workspaceId)?.ownerPrincipalId,
        selectCanAdministerHost.select(store.state)).remove;
    },
    canPublish: admitted,
  };
}

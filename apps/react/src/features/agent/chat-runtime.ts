import { createChatDraftOwnership } from '../../../../../src/features/agent/chat-draft-ownership';
import { getWorkspaceParticipationContext } from '../../../../../src/store/renderer/slices/workspace/workspace-authority-projections';
import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { m } from '$shared/paraglide/messages.js';
import { store } from '@/store';
import { backend, onBackendReconnected } from '@/features/backend/backend-transport';
import { agentReadOwnership, readAgentSession } from './agent-read-service';
import { notify } from '@/components/patterns/notify';
import { createConversationReader } from '$lib/client/live/backend-conversation-reader';
import { createBackendChatCommands } from '$lib/client/live/backend-chat-commands';
import { createBackendDraftsClient } from '$lib/client/live/backend-drafts-client';
import { createBackendAttachmentPlacement } from '$lib/client/live/backend-attachment-placement';
import { supportsIdempotentPlacementProtocol } from '$lib/client/live/attachment-upload';
import {
  toImageReferenceBlocks,
  imageRetryBlocks as retryImageBlocks,
  type WireImageBlock,
} from '$lib/client/live/image-attachment-placement';
import { ErrorBoundaryService } from '../../../../../src/features/agent/browser/error-boundary-core';
import { createAgentSender } from '../../../../../src/features/agent/agent-send-factory';
import { createSubmissionEvidence } from '../../../../../src/features/agent/submission-evidence-factory';
import { createAgentQueueReadService } from '../../../../../src/features/agent/agent-queue-read-service-factory';
import { createChatReadService } from '../../../../../src/features/agent/chat-read-service-factory';
import { createAgentSubmissionAdmitter } from '../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-admission-factory';
import { createChatSubmission } from '../../../../../src/features/agent/chat-submission-factory';
import { createSubmissionRetry } from '../../../../../src/features/agent/chat-submission-retry-factory';
export const captureDraftOwnership = createChatDraftOwnership(
  store,
  agentReadOwnership.captureAgentMutationOwnership,
);
const attachmentPlacement = createBackendAttachmentPlacement(backend.backendRequest);
async function placementApi(current: () => boolean) {
  if (!current()) throw new Error(m.workspace_client_accessChanged_error());
  // React does not run the source health dashboard poller. Read the current
  // daemon contract at this mutation boundary rather than assuming a version.
  const status = await backend.backendRequest<{ protocolVersion?: string }>('system.status');
  if (!current()) throw new Error(m.workspace_client_accessChanged_error());
  return {
    ...attachmentPlacement,
    mintIdempotencyKey: (existing?: string) =>
      supportsIdempotentPlacementProtocol(status.protocolVersion)
        ? (existing ?? crypto.randomUUID())
        : undefined,
  };
}
export async function placeComposerAttachment(
  workspaceId: string,
  file: File,
  options: {
    idempotencyKey: string;
    signal: AbortSignal;
    current: () => boolean;
    onProgress: (fraction: number) => void;
  },
) {
  options.signal.throwIfAborted();
  const api = await placementApi(options.current);
  options.signal.throwIfAborted();
  return api.place(workspaceId, file.name, file, {
    ...options,
    mimeType: file.type || undefined,
    idempotencyKey: api.mintIdempotencyKey(options.idempotencyKey),
  });
}
type Images = NonNullable<
  import('../../../../../src/store/renderer/slices/chat-state/chat-state-types').SendMessagePayload['imageBlocks']
>;
function wireImages(images: Images): WireImageBlock[] {
  for (const image of images) {
    if (image.attachmentId || (typeof image.data === 'string' && image.mimeType)) continue;
    throw new Error(m.agent_streamLifecycle_sendFailed_error());
  }
  return images as WireImageBlock[];
}
export async function prepareComposerImages(workspaceId: string, images: Images, agentId: string) {
  const current = captureDraftOwnership(workspaceId, agentId);
  return toImageReferenceBlocks(
    workspaceId,
    wireImages(images),
    await placementApi(current),
    current,
  );
}
export function imageRetryBlocks(error: unknown, images: Images): Images {
  return retryImageBlocks(error, images as WireImageBlock[]);
}
export const chatCommands = createBackendChatCommands(backend.backendRequest);
export const draftsClient = createBackendDraftsClient(
  async <T>(...args: Parameters<typeof backend.backendRequest>) => {
    const [method, params, options] = args;
    const { workspaceId, agentId } = params as { workspaceId: string; agentId: string };
    const participation = getWorkspaceParticipationContext(store.state, workspaceId);
    const principal = getPrincipalSnapshot(store.state)?.principal.id;
    const ownership = agentReadOwnership.captureAgentMutationOwnership(agentId, workspaceId);
    const current = () =>
      !!participation &&
      !!principal &&
      getWorkspaceParticipationContext(store.state, workspaceId) === participation &&
      getPrincipalSnapshot(store.state)?.principal.id === principal &&
      store.state.agentSessions.byAgentId[agentId]?.workspaceId === workspaceId &&
      ownership.isCurrent(workspaceId);
    if (!current()) throw new Error(m.workspace_client_accessChanged_error());
    const result = await backend.backendRequest<T>(method, params, options);
    if (!current()) throw new Error(m.workspace_client_accessChanged_error());
    return result;
  },
);
export const submissionEvidence = createSubmissionEvidence(store);
export const queueReads = createAgentQueueReadService({
  appStore: store,
  agents: chatCommands,
  claimAgentReadOwnership: agentReadOwnership.claimAgentReadOwnership,
  onBackendReconnected,
  beginSubmissionRead: submissionEvidence.beginSubmissionRead,
});
export const chatReads = createChatReadService({
  appStore: store,
  agents: { getConversation: createConversationReader(backend) },
  claimAgentReadOwnership: agentReadOwnership.claimAgentReadOwnership,
  onBackendReconnected,
  readAgentSession,
  beginSubmissionRead: submissionEvidence.beginSubmissionRead,
});
export const sendAgentMessage = createAgentSender({
  appStore: store,
  backendRequest: backend.backendRequest,
  captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
  loadChatTranscript: chatReads.loadChatTranscript,
  hydrateAgentQueue: queueReads.hydrateAgentQueue,
  getAgentQueueEventSnapshotSeq: queueReads.getAgentQueueEventSnapshotSeq,
  errorBoundary: new ErrorBoundaryService(notify),
});
export const chatSubmission = createChatSubmission(
  createAgentSubmissionAdmitter(agentReadOwnership.captureAgentMutationOwnership),
);
export const submissionRetry = createSubmissionRetry({
  store,
  ...chatSubmission,
  hydrateAgentQueue: queueReads.hydrateAgentQueue,
  loadChatTranscript: chatReads.loadChatTranscript,
  getNotify: async () => notify,
});

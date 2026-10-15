import { selectFileReadContext } from '@/store/files/files-selectors';
import { createFileRead } from '$lib/client/live/backend-file-read';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
} from '@/store/file-explorer/file-explorer-selectors';
import { prepareRepositoryFileContext } from '$lib/components/chat/chat-repository-file-context';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { getPrincipalConnectionContext } from '../../../../../src/store/renderer/slices/principal/principal-context';
import { selectChatDraftOwnerView } from '@/store/chat-drafts/chat-drafts-selectors';
import { selectSubmissionIsCurrent } from '@/store/pending-submissions/pending-submissions-selectors';
import type { SubmissionReference } from '../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-types';
import { selectAvailableContextNotes } from '@/store/chat-drafts/note-context-selectors';
import { placementApi } from './attachment-placement-runtime';
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
export const chatCommands = createBackendChatCommands(backend.backendRequest, {
  strictQueue: true,
});
export function validateQueueAdmission(
  agentId: string,
  workspaceId: string,
  ownerId: string,
  submission: SubmissionReference | undefined,
) {
  const owner = selectChatDraftOwnerView.select(store.state, ownerId)?.restore;
  if (
    !owner ||
    owner.status !== 'restored' ||
    owner.workspaceId !== workspaceId ||
    owner.agentId !== agentId ||
    !submission ||
    !selectSubmissionIsCurrent.select(store.state, submission) ||
    submission.scope.authority !== getPrincipalConnectionContext(store.state) ||
    !getWorkspaceParticipationContext(store.state, workspaceId) ||
    store.state.agentSessions.byAgentId[agentId]?.workspaceId !== workspaceId
  )
    throw new Error(m.workspace_client_accessChanged_error());
}
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
    const result = await backend.backendRequest<T>(method, params, {
      ...options,
      onDispatch: () => {
        if (!current()) throw new Error(m.workspace_client_accessChanged_error());
        options?.onDispatch?.();
      },
    });
    if (!current()) throw new Error(m.workspace_client_accessChanged_error());
    return result;
  },
);
export const submissionEvidence = createSubmissionEvidence(store);
export const queueReads = createAgentQueueReadService({
  appStore: store,
  agents: chatCommands,
  claimAgentReadOwnership: (agentId, workspaceId) => {
    const lease = agentReadOwnership.claimAgentReadOwnership(agentId, workspaceId);
    const context = workspaceId
      ? selectAdmittedWorkspaceReadContext.select(store.state, workspaceId)
      : null;
    const draftOwners = store.state.chatDrafts.owners;
    // A queue read belongs to this admitted conversation lifetime, not merely its ID.
    const owner = getItems(draftOwners).find(
      (entry) => entry.restore?.agentId === agentId && entry.restore.workspaceId === workspaceId,
    );
    return {
      ...lease,
      key: JSON.stringify([lease.key, context, owner?.id]),
      isCurrent: () =>
        !!workspaceId &&
        !!context &&
        !!owner &&
        selectChatDraftOwnerView.select(store.state, owner.id)?.restore?.agentId === agentId &&
        selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === context &&
        lease.isCurrent(),
    };
  },
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
function validateComposerReferences({
  agentId,
  workspaceId,
  noteIds,
  contextReferences,
  noteContextOwnerId,
}: Parameters<
  NonNullable<Parameters<typeof createAgentSender>[0]['validateContextReferences']>
>[0]) {
  const references = contextReferences?.filter((ref) => ref.type === 'note') ?? [];
  const files = contextReferences?.filter((ref) => ref.type === 'file') ?? [];
  if (!references.length && !noteIds?.length && !files.length) return;
  const owner = noteContextOwnerId
    ? selectChatDraftOwnerView.select(store.state, noteContextOwnerId)?.restore
    : undefined;
  if (
    !owner ||
    owner.status !== 'restored' ||
    owner.workspaceId !== workspaceId ||
    owner.agentId !== agentId
  )
    throw new Error(m.workspace_client_accessChanged_error());
  const notes = selectAvailableContextNotes.select(store.state, workspaceId);
  if (
    references.length !== (noteIds?.length ?? 0) ||
    references.some(
      (ref) =>
        !ref.noteId ||
        !noteIds?.includes(ref.noteId) ||
        !ref.metadata ||
        typeof ref.metadata !== 'object' ||
        !('workspaceId' in ref.metadata) ||
        ref.metadata.workspaceId !== workspaceId,
    ) ||
    noteIds?.some((id) => !notes.some((note) => note.id === id))
  )
    throw new Error(m.chat_noteContext_unavailable_error());
  if (files.length) {
    if (!selectFileReadContext.select(store.state, workspaceId, agentId))
      throw new Error(m.chat_fileContext_unavailable_error());
    const root = selectFileExplorerRoot.select(store.state, workspaceId);
    if (
      !selectFileExplorerContext.select(store.state, workspaceId) ||
      !prepareRepositoryFileContext(
        workspaceId,
        root,
        files.map((ref, index) => ({
          id: String(index),
          type: 'file',
          label: '',
          repositoryFile: {
            workspaceId:
              ref.metadata &&
              typeof ref.metadata === 'object' &&
              'workspaceId' in ref.metadata &&
              typeof ref.metadata.workspaceId === 'string'
                ? ref.metadata.workspaceId
                : '',
            rootPath:
              ref.metadata &&
              typeof ref.metadata === 'object' &&
              'rootPath' in ref.metadata &&
              typeof ref.metadata.rootPath === 'string'
                ? ref.metadata.rootPath
                : '',
            path: ref.filePath ?? '',
          },
        })),
      ).ok
    )
      throw new Error(m.chat_fileContext_unavailable_error());
  }
  const session = store.state.agentSessions.byAgentId[agentId];
  if (!session || session.workspaceId !== workspaceId)
    throw new Error(m.workspace_client_accessChanged_error());
  // Optimistic isStreaming belongs to this submission; only daemon turn facts block it.
  if (session.isResponding || session.turnInFlight)
    throw new Error(m.chat_fileContext_busy_description());
}

export const sendAgentMessage = createAgentSender({
  appStore: store,
  backendRequest: backend.backendRequest,
  captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
  loadChatTranscript: chatReads.loadChatTranscript,
  hydrateAgentQueue: queueReads.hydrateAgentQueue,
  getAgentQueueEventSnapshotSeq: queueReads.getAgentQueueEventSnapshotSeq,
  errorBoundary: new ErrorBoundaryService(notify),
  validateContextReferences: validateComposerReferences,
  prepareContextReferences: async (context) => {
    const files = context.contextReferences?.filter((ref) => ref.type === 'file') ?? [];
    if (!files.length) return;
    const admission = selectFileExplorerContext.select(store.state, context.workspaceId);
    const validate = () => {
      if (
        !context.isCurrent() ||
        !admission ||
        selectFileExplorerContext.select(store.state, context.workspaceId) !== admission
      )
        throw new Error(m.workspace_client_accessChanged_error());
      validateComposerReferences(context);
    };
    const read = createFileRead((method, params, options) => {
      validate();
      return backend.backendRequest(method, params, { ...options, onDispatch: validate });
    });
    for (const reference of files) {
      validate();
      const entry = await read(context.workspaceId, reference.filePath!, { readOnlyPreview: true });
      validate();
      if (!entry || entry.kind !== 'read-only-text' || entry.truncated || entry.error)
        throw new Error(m.chat_fileContext_unavailable_error());
    }
  },
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

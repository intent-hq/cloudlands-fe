import { expect, it, vi } from 'vitest';
import { File as NativeFile } from 'node:buffer';
import { store } from '@/store';
import { draftsClient, captureDraftOwnership } from '@/features/agent/chat-runtime';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../src/store/renderer/slices/principal/principal-slice';
import { runChatDrafts } from '../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftSaveScheduled,
} from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-slice';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({
  backend: { backendRequest: transport.request },
  onBackendReconnected: () => () => {},
}));
vi.mock('@/components/patterns/notify', () => ({ notify: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/agent/agent-read-service', async () => {
  const { createAgentReadOwnership } =
    await import('../../../../../src/features/agent/agent-read-ownership-factory');
  const { store } = await import('@/store');
  return {
    agentReadOwnership: createAgentReadOwnership({
      onBackendReconnected: () => () => {},
      getSessionWorkspace: (id) => store.state.agentSessions.byAgentId[id]?.workspaceId,
    }),
    readAgentSession: vi.fn(),
  };
});
it('does not save a prior principal draft through a newly admitted principal', async () => {
  const initial = createAdmittedLegacyPrincipal();
  const dispose = store.init(initial);
  transport.request.mockImplementation(async () => ({ ok: true, updatedAt: '' }));
  store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: 'owner' } as any));
  store.dispatch(
    bulkUpsertSessions([
      {
        id: 'agent',
        workspaceId: 'workspace',
        status: 'idle',
        messages: [],
        createdAt: '',
        updatedAt: '',
      } as any,
    ]),
  );
  const stop = store.runSaga(function* () {
    yield* runChatDrafts(draftsClient, captureDraftOwnership);
  });
  try {
    store.dispatch(chatDraftOwnerOpened('old-owner'));
    store.dispatch(
      chatDraftSaveScheduled('old-owner', 'old-write', {
        workspaceId: 'workspace',
        agentId: 'agent',
        text: 'private prior-principal input',
        attachments: [],
        rollback: null,
      }),
    );
    const context = store.state.principal.context!;
    store.dispatch(principalContextChanged(context));
    const snapshot = structuredClone(initial.principal.snapshot!);
    snapshot.principal.id = 'new-principal';
    store.dispatch(
      principalReceived({ context, invalidation: 0, presentationVersion: 0 }, snapshot),
    );
    expect(store.state.principal.snapshot?.principal.id).toBe('new-principal');
    store.dispatch(chatDraftOwnerReleased('old-owner'));
    await Promise.resolve();
    expect(transport.request).not.toHaveBeenCalled();
  } finally {
    stop();
    dispose();
  }
});

it.each(['9.13', '9.12'])(
  'checks the actual daemon protocol before placing bytes (%s)',
  async (protocolVersion) => {
    const { placeComposerAttachment } = await import('./chat-runtime');
    transport.request.mockReset();
    transport.request.mockImplementation(async (method) =>
      method === 'system.status'
        ? { protocolVersion }
        : {
            attachmentId: 'placed',
            fileName: 'safe.txt',
            path: '.intent/attachments/safe.txt',
            size: 5,
          },
    );
    const controller = new AbortController();
    const file = new NativeFile(['hello'], 'safe.txt', { type: 'text/plain' }) as unknown as File;
    await placeComposerAttachment('workspace', file, {
      idempotencyKey: 'key',
      signal: controller.signal,
      current: () => true,
      onProgress: () => {},
    });
    expect(transport.request.mock.calls[0][0]).toBe('system.status');
    expect(transport.request.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'file.placeAttachment',
      {
        workspaceId: 'workspace',
        fileName: 'safe.txt',
        data: 'aGVsbG8=',
        mimeType: 'text/plain',
        ...(protocolVersion === '9.13' ? { idempotencyKey: 'key' } : {}),
      },
    ]);
  },
);
it.each(['authority', 'cancel'] as const)(
  'does not upload after %s retires while status is pending',
  async (retirement) => {
    const { placeComposerAttachment } = await import('./chat-runtime');
    let resolve!: (value: { protocolVersion: string }) => void;
    transport.request.mockReset().mockImplementation(
      () =>
        new Promise((ok) => {
          resolve = ok;
        }),
    );
    const controller = new AbortController();
    let current = true;
    const promise = placeComposerAttachment('workspace', new File(['hello'], 'safe.txt'), {
      idempotencyKey: 'key',
      signal: controller.signal,
      current: () => current,
      onProgress: () => {},
    });
    const rejected = expect(promise).rejects.toThrow();
    if (retirement === 'authority') current = false;
    else controller.abort();
    resolve({ protocolVersion: '9.13' });
    await rejected;
    expect(transport.request).toHaveBeenCalledTimes(1);
  },
);

it.each(['valid', 'deleted', 'retired', 'wrong-workspace', 'busy'] as const)(
  'validates canonical note references at final transport dispatch (%s)',
  async (scenario) => {
    const { sendAgentMessage, chatSubmission } = await import('./chat-runtime');
    const { setWorkspaceHasLoaded } =
      await import('../../../../../src/store/renderer/slices/workspace/workspace-slice');
    const { getPrincipalActionContext } =
      await import('../../../../../src/store/renderer/slices/principal/principal-projections');
    const { loadWorkspaceNotesSucceeded, applyNoteDeleted } =
      await import('../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice');
    const { chatDraftRestoreRequested, chatDraftRestoreSettled } =
      await import('../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-slice');
    const initial = createAdmittedLegacyPrincipal();
    initial.principal.snapshot!.capabilities.submissionCorrelation = 1;
    const dispose = store.init(initial);
    const workspace = {
      id: 'workspace',
      myRole: 'owner',
      title: 'Owned',
      worktreePath: '/owned/repo',
    } as any;
    const session = {
      id: 'agent',
      workspaceId: 'workspace',
      status: 'idle',
      backendSessionId: 'backend',
      messages: [],
      createdAt: '',
      updatedAt: '',
      isStreaming: true,
      isResponding: false,
      turnInFlight: false,
    } as any;
    store.dispatch(setWorkspaceEntity(workspace));
    store.dispatch(
      setWorkspaceHasLoaded(
        true,
        store.state.connections.windowBackendId,
        getPrincipalActionContext(store.state),
      ),
    );
    store.dispatch(bulkUpsertSessions([session]));
    store.dispatch(
      loadWorkspaceNotesSucceeded(['workspace'], {
        workspace: [
          {
            id: 'note',
            workspaceId: 'workspace',
            title: 'Plan',
            content: '',
            contentType: 'markdown',
            isArchived: false,
          } as any,
        ],
      }),
    );
    store.dispatch(chatDraftOwnerOpened('context-owner'));
    store.dispatch(chatDraftRestoreRequested('context-owner', 'restore', 'workspace', 'agent'));
    store.dispatch(
      chatDraftRestoreSettled('context-owner', 'restore', 'restored', {
        text: 'Read this note',
        attachments: [],
      }),
    );
    const references = [
      {
        type: 'note',
        noteId: 'note',
        metadata: { workspaceId: scenario === 'wrong-workspace' ? 'other' : 'workspace' },
      },
    ];
    const admitted = chatSubmission.admitChatMessage(store, 'agent', {
      wsId: 'workspace',
      text: 'Read this note',
      contextItems: [
        { id: 'ref', type: 'note', noteId: 'note', workspaceId: 'workspace', label: 'Plan' },
      ],
    });
    expect(admitted).toBeTruthy();
    const { createAgentActivationWorkers } =
      await import('../../../../../src/store/renderer/slices/agent-session/sagas/agent-activation-workers');
    const { agentReadOwnership, readAgentSession } = await import('./agent-read-service');
    const { selectAgentSession } = await import('@/store/agent-session/agent-session-selectors');
    const { restoreAgentSessionRequested } =
      await import('../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice');
    const { takeEvery } = await import('typed-redux-saga');
    const activation = createAgentActivationWorkers({
      selectAgentSession,
      captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
      readAgentSession,
    });
    const stop = store.runSaga(function* () {
      yield* takeEvery(restoreAgentSessionRequested, activation.restoreAgent);
    });
    const wire: unknown[] = [];
    transport.request.mockReset().mockImplementation(async (method, params, options) => {
      if (method === 'agent.sendMessage') {
        if (scenario === 'deleted') store.dispatch(applyNoteDeleted('workspace', 'note'));
        if (scenario === 'retired') store.dispatch(chatDraftOwnerReleased('context-owner'));
        if (scenario === 'busy')
          store.dispatch(bulkUpsertSessions([{ ...session, isResponding: true }]));
        options?.onDispatch?.();
        wire.push(params);
        return { success: true };
      }
      if (method === 'agent.get') return { agent: session };
      if (method === 'agent.getConversation') return { agentId: 'agent', messages: [] };
      return {};
    });
    try {
      await sendAgentMessage('agent', 'Read this note', workspace, {
        noteIds: ['note'],
        contextReferences: references,
        noteContextOwnerId: 'context-owner',
        submission: { scope: admitted!.scope, id: admitted!.submission.id },
      }).catch(() => {});
      expect(wire).toHaveLength(scenario === 'valid' ? 1 : 0);
    } finally {
      stop();
      dispose();
    }
  },
);

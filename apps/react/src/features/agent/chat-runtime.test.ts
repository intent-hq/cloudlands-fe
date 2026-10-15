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

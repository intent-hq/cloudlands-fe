import { runSaga, stdChannel } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { afterEach, expect, it, vi } from 'vitest';
import {
  transientUiReducer,
  initialState,
  setChatDraft,
} from '../../transient-ui/transient-ui-slice';
import { getComposerContextItems, getChatDraft } from '../../transient-ui/transient-ui-projections';
import { chatDraftSaveScheduled } from '../chat-drafts-slice';
import {
  composerAttachmentsSelected,
  composerAttachmentRemoved,
  composerAttachmentRetryRequested,
  composerAttachmentsReleased,
} from '../chat-drafts-slice';
import { createComposerAttachmentsSaga } from './composer-attachments-saga-factory';
import {
  serializeDraftAttachments,
  deserializeDraftAttachments,
} from '$lib/components/chat/chat-draft-attachments';
import { extractAttachmentBlocks } from '$lib/components/chat/chat-attachment-blocks';

import { createAdmittedLegacyPrincipal } from '../../../../../test/fixtures/admitted-legacy-principal';
import { createChatDraftOwnership } from '../../../../../features/agent/chat-draft-ownership';
import { createAgentReadOwnership } from '../../../../../features/agent/agent-read-ownership-factory';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
type Dependencies = Parameters<typeof createComposerAttachmentsSaga>[0];
type Placement = Awaited<ReturnType<Dependencies['place']>>;
const done = (name = 'safe.txt'): Placement => ({
  attachmentId: `registered-${name}`,
  fileName: name,
  size: 5,
  mimeType: 'text/plain',
  path: `.intent/attachments/${name}`,
});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function harness() {
  let generation = 1;
  let state = {
    ...createAdmittedLegacyPrincipal({
      daemonHealth: { connectionGeneration: generation },
      workspaceEvents: { subscriptionGeneration: generation },
    }),
    userPreferences: { labsMultiplayerEnabled: false },
    workspace: { workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner' }]) },
    agentSessions: { byAgentId: { agent: { workspaceId: 'ws' } } },
    transientUi: initialState,
  };
  const ownership = createAgentReadOwnership({
    onBackendReconnected: () => () => {},
    getSessionWorkspace: () => 'ws',
  });
  const captureOwnership = createChatDraftOwnership(
    {
      get state() {
        return state as any;
      },
    },
    ownership.captureAgentMutationOwnership,
  );
  const channel = stdChannel();
  const saves: ReturnType<typeof chatDraftSaveScheduled>[] = [];
  const dispatch = (action: Parameters<typeof transientUiReducer>[1]) => {
    state = { ...state, transientUi: transientUiReducer(state.transientUi, action) };
    if (action.type === chatDraftSaveScheduled.type)
      saves.push(action as ReturnType<typeof chatDraftSaveScheduled>);
    channel.put(action);
    return action;
  };
  const place = vi.fn<Dependencies['place']>();
  const task = runSaga(
    { channel, dispatch, getState: () => state },
    createComposerAttachmentsSaga({
      selectItems: {
        *effect(ws, agent) {
          return yield* select(getComposerContextItems, ws, agent);
        },
      },
      selectText: {
        *effect(ws, agent) {
          return yield* select(getChatDraft, ws, agent);
        },
      },
      captureOwnership,
      place,
    }),
  );
  cleanups.push(() => task.cancel());
  return {
    dispatch,
    place,
    saves,
    task,
    items: () => getComposerContextItems(state, 'ws', 'agent'),
    state: () => state,
    changePrincipal: () => {
      state = {
        ...state,
        principal: {
          ...state.principal,
          snapshot: {
            ...state.principal.snapshot!,
            principal: { ...state.principal.snapshot!.principal, id: 'replacement' },
          },
        },
      };
    },
    disconnect: () => {
      state = { ...state, principal: { ...state.principal, snapshot: null, status: 'unknown' } };
      ownership.invalidate();
    },
    changeBackend: () => {
      state = { ...state, connections: { ...state.connections, windowBackendId: 'other' } };
    },
    reconnect: () => {
      generation++;
      state = {
        ...state,
        ...createAdmittedLegacyPrincipal({
          daemonHealth: { connectionGeneration: generation },
          workspaceEvents: { subscriptionGeneration: generation },
        }),
      };
      ownership.invalidate();
    },
  };
}
const choose = (files = [new File(['hello'], 'safe.txt', { type: 'text/plain' })]) =>
  composerAttachmentsSelected('owner', 'ws', 'agent', files);

it('keeps File bytes out of Redux and merges completion into newer text and attachments', async () => {
  const h = harness(),
    a = deferred<Placement>(),
    b = deferred<Placement>();
  h.place.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  h.dispatch(choose());
  h.dispatch(setChatDraft('ws', 'agent', 'newer text', true));
  h.dispatch(choose([new File(['image'], 'safe.png', { type: 'image/png' })]));
  expect(h.items()).toHaveLength(2);
  expect(h.items().every((item) => !('file' in item))).toBe(true);
  expect(() => structuredClone(h.state())).not.toThrow();
  a.resolve(done());
  await vi.waitFor(() => expect(h.items()[0].attachmentId).toBe('registered-safe.txt'));
  expect(h.saves.at(-1)?.payload[2].text).toBe('newer text');
  expect(h.saves.at(-1)?.payload[2].attachments).toHaveLength(2);
  b.resolve({ ...done('safe.png'), mimeType: 'image/png' });
  await vi.waitFor(() => expect(h.items()[1].placementStatus).toBe('placed'));
  const restored = deserializeDraftAttachments(serializeDraftAttachments(h.items()));
  expect(extractAttachmentBlocks(restored)).toEqual({
    imageBlocks: [{ type: 'image', attachmentId: 'registered-safe.png', mimeType: 'image/png' }],
    fileBlocks: [
      {
        type: 'file',
        attachmentId: 'registered-safe.txt',
        fileName: 'safe.txt',
        mimeType: 'text/plain',
        size: 5,
      },
    ],
  });
});
it.each(['remove', 'release'] as const)(
  'aborts %s with authority intact and rejects a late successful placement',
  async (operation) => {
    const h = harness(),
      upload = deferred<Placement>();
    h.place.mockReturnValue(upload.promise);
    h.dispatch(choose());
    const id = h.items()[0].id,
      options = h.place.mock.calls[0][2];
    h.dispatch(
      operation === 'remove'
        ? composerAttachmentRemoved('owner', 'ws', 'agent', id)
        : composerAttachmentsReleased('owner'),
    );
    expect(options.signal.aborted).toBe(true);
    expect(options.current()).toBe(true); // The original session may still be safely aborted.
    upload.resolve(done());
    await Promise.resolve();
    await Promise.resolve();
    expect(h.items().some((item) => item.attachmentId)).toBe(false);
    if (operation === 'release') {
      expect(h.items()[0]).toMatchObject({ placementStatus: 'failed' });
      expect(h.items()[0].placementIdempotencyKey).toBeUndefined();
      expect(serializeDraftAttachments(h.items())).toHaveLength(1);
    } else expect(h.items()).toEqual([]);
  },
);
it('reuses placement identity after a failed upload while retaining newer text', async () => {
  const h = harness();
  h.place.mockRejectedValueOnce(new Error('lost placement reply')).mockResolvedValueOnce(done());
  h.dispatch(choose());
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('failed'));
  h.dispatch(setChatDraft('ws', 'agent', 'edited during failure', true));
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', h.items()[0].id));
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('placed'));
  expect(h.place.mock.calls[1][2].idempotencyKey).toBe(h.place.mock.calls[0][2].idempotencyKey);
  expect(h.saves.at(-1)?.payload[2].text).toBe('edited during failure');
});
it('does not publish or retry prior-principal bytes through a replacement authority', async () => {
  const h = harness(),
    upload = deferred<Placement>();
  h.place.mockReturnValue(upload.promise);
  h.dispatch(choose());
  const options = h.place.mock.calls[0][2],
    id = h.items()[0].id;
  const saves = h.saves.length;
  h.changePrincipal();
  expect(options.current()).toBe(false);
  upload.resolve(done());
  await Promise.resolve();
  await Promise.resolve();
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', id));
  h.dispatch(composerAttachmentsReleased('owner'));
  expect(h.place).toHaveBeenCalledTimes(1);
  expect(h.saves).toHaveLength(saves);
  expect(h.items()[0].attachmentId).toBeUndefined();
});
it('lets the same principal explicitly retry a retired upload after reconnect', async () => {
  const h = harness(),
    upload = deferred<Placement>();
  h.place.mockReturnValueOnce(upload.promise).mockResolvedValueOnce(done());
  h.dispatch(choose());
  h.reconnect();
  upload.reject(new Error('connection retired'));
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('failed'));
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', h.items()[0].id));
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('placed'));
  expect(h.place.mock.calls[0][2].current()).toBe(false);
  expect(h.place.mock.calls[1][2].current()).toBe(true);
});
it('aborts owned resources on root cancellation without saving through a retired owner', () => {
  const h = harness(),
    upload = deferred<Placement>();
  h.place.mockReturnValue(upload.promise);
  h.dispatch(choose());
  const options = h.place.mock.calls[0][2];
  h.task.cancel();
  expect(options.signal.aborted).toBe(true);
  expect(h.saves).toHaveLength(1);
});

it('retires the pending pill before re-admission and retries only after the same identity is admitted', async () => {
  const h = harness(),
    upload = deferred<Placement>();
  h.place.mockReturnValueOnce(upload.promise).mockResolvedValueOnce(done());
  h.dispatch(choose());
  const id = h.items()[0].id,
    saves = h.saves.length;
  h.disconnect();
  upload.reject(new Error('socket closed before re-admission'));
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('failed'));
  expect(h.saves).toHaveLength(saves);
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', id));
  expect(h.place).toHaveBeenCalledTimes(1);
  h.reconnect();
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', id));
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('placed'));
});
it('rejects attachment retry through a different backend', async () => {
  const h = harness();
  h.place.mockRejectedValue(new Error('failure'));
  h.dispatch(choose());
  await vi.waitFor(() => expect(h.items()[0].placementStatus).toBe('failed'));
  h.changeBackend();
  h.dispatch(composerAttachmentRetryRequested('owner', 'ws', 'agent', h.items()[0].id));
  expect(h.place).toHaveBeenCalledTimes(1);
});

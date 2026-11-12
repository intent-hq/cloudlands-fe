import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLiveDraftSyncConnection } from '$lib/components/chat/chat-draft-sync';
import { clearDraftCacheForTests } from '$lib/components/chat/chat-draft-cache';
import { DRAFT_SYNC_METHOD } from '$shared/types/chat-draft-sync';
import {
  chatDraftClearRequested,
  chatDraftOwnerOpened,
  chatDraftRestoreRequested,
  chatDraftSaveScheduled,
  chatDraftsReducer,
  initialState,
} from '../chat-drafts-slice';
import { CHAT_DRAFT_SAVE_DEBOUNCE_MS, chatDraftsSaga } from './chat-drafts-saga';

// Keep the production draft client, saga defaults, and sync factory. Only the
// backend response boundary and document identity are controlled by this test.
vi.mock('$lib/client', async () => {
  const { LiveDraftsClient } = await import('$lib/client/live/live-drafts-client');
  return { appClient: { drafts: new LiveDraftsClient() } };
});
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));
vi.mock('$store/renderer/slices/principal/principal-context', () => ({
  getPrincipalActionContext: () => 'document-1',
  getPrincipalDraftProvenance: () => 'backend-1/principal-1',
}));

const WS = 'workspace-1';
const AGENT = 'agent-1';
const OWNER = 'owner-1';

function startDefaultSaga() {
  let state = initialState;
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof chatDraftsReducer>[1]) => {
    state = chatDraftsReducer(state, action);
    channel.put(action);
    return action;
  };
  // No injected transport or explicit null sync: exercise production defaults.
  const task = runSaga(
    { channel, dispatch, getState: () => ({ chatDrafts: state }) },
    chatDraftsSaga,
  );
  dispatch(chatDraftOwnerOpened(OWNER));
  return { task, dispatch, owner: () => getItem(state.owners, OWNER) };
}

describe('production draft factory platform selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearDraftCacheForTests();
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'drafts.get') return { text: 'restored', updatedAt: '2026-11-12T00:00:00Z' };
      if (method === 'drafts.set') return { ok: true, updatedAt: '2026-11-12T00:00:00Z' };
      if (method === 'drafts.clear') return { ok: true };
      throw new Error(`Unexpected desktop-only method: ${method}`);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    { bridge: 'missing', wsUrl: '' },
    { bridge: 'missing', wsUrl: 'ws://localhost:9100/rpc' },
    { bridge: 'browser-mock', wsUrl: '' },
    { bridge: 'browser-mock', wsUrl: 'ws://localhost:9100/rpc' },
  ])('keeps daemon draft operations with $bridge and WS "$wsUrl"', async ({ bridge, wsUrl }) => {
    vi.stubGlobal('window', {
      ...window,
      electronAPI:
        bridge === 'missing'
          ? undefined
          : {
              ...window.electronAPI,
              versions: { node: '26.10.0', chrome: '120.0.0', electron: '0.0.0-browser' },
            },
    });
    vi.stubEnv('VITE_INTENTD_WS_URL', wsUrl);
    const { task, dispatch, owner } = startDefaultSaga();
    try {
      dispatch(chatDraftRestoreRequested(OWNER, 'restore', WS, AGENT));
      await vi.advanceTimersByTimeAsync(0);
      expect(owner()?.restore).toMatchObject({ status: 'restored', draft: { text: 'restored' } });
      dispatch(
        chatDraftSaveScheduled(OWNER, 'save', {
          workspaceId: WS,
          agentId: AGENT,
          text: 'new typing',
          attachments: [],
          rollback: null,
        }),
      );
      await vi.advanceTimersByTimeAsync(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
      expect(getItem(owner()!.saves, 'save')).toMatchObject({ status: 'saved' });
      dispatch(chatDraftClearRequested(WS, AGENT));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.mocked(backendRequest).mock.calls).toEqual([
        ['drafts.get', { workspaceId: WS, agentId: AGENT }],
        ['drafts.set', { workspaceId: WS, agentId: AGENT, text: 'new typing' }],
        ['drafts.clear', { workspaceId: WS, agentId: AGENT }],
      ]);
    } finally {
      task.cancel();
      await task.toPromise();
    }
  });

  it('keeps the scoped desktop client with a real bridge even when a WS URL is configured', async () => {
    vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://localhost:9100/rpc');
    vi.stubGlobal('window', {
      ...window,
      electronAPI: {
        ...window.electronAPI,
        versions: { node: '26.10.0', chrome: '120.0.0', electron: '39.0.0' },
      },
    });
    const draft = {
      provenance: 'backend-1/principal-1',
      workspaceId: WS,
      agentId: AGENT,
      lifetime: 'broker-1',
      revision: 1,
      origin: '',
      sequence: 0,
      snapshot: { text: 'shared', attachments: [] },
    };
    vi.mocked(backendRequest).mockResolvedValue({ accepted: true, draft });
    const connection = createLiveDraftSyncConnection();
    expect(connection).not.toBeNull();
    try {
      expect(await connection?.read(WS, AGENT)).toEqual(draft);
      expect(vi.mocked(backendRequest).mock.calls).toEqual([
        [
          DRAFT_SYNC_METHOD,
          { kind: 'read', provenance: draft.provenance, workspaceId: WS, agentId: AGENT },
        ],
      ]);
    } finally {
      connection?.dispose();
    }
  });
});

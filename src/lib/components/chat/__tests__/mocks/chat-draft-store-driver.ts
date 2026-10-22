/**
 * Runs the real chat-drafts reducer + saga against an injected `drafts`
 * transport, exposing the store seam `createChatDraftManager` consumes. Tests
 * that render against a mocked app store forward its dispatches here and read
 * `state` back as the `chatDrafts` slice.
 */
import { runSaga, stdChannel, type Task } from 'redux-saga';

import type { DraftsClient } from '$lib/client/app-client';
import { selectChatDraftOwnerView } from '$store/renderer/slices/chat-drafts/chat-drafts-selectors';
import {
  chatDraftsReducer,
  initialState,
  type ChatDraftsState,
} from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import type { ChatDraftStorePort } from '../../chat-panel-draft.svelte';

type DraftsTransport = Pick<DraftsClient, 'get' | 'set'> & Partial<Pick<DraftsClient, 'clear'>>;
type AnyAction = { type: string };

export interface ChatDraftStoreDriver {
  readonly state: ChatDraftsState;
  readonly port: ChatDraftStorePort;
  /** Feeds an action through the reducer and saga; non-draft actions are ignored. */
  dispatch: (action: AnyAction) => AnyAction;
  subscribe: (listener: () => void) => () => void;
  stop: () => void;
}

export function createChatDraftStoreDriver(drafts: DraftsTransport): ChatDraftStoreDriver {
  let state = initialState;
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  const dispatch = (action: AnyAction) => {
    if (!action?.type?.startsWith('chatDrafts/')) return action;
    state = chatDraftsReducer(state, action as Parameters<typeof chatDraftsReducer>[1]);
    channel.put(action);
    for (const listener of [...listeners]) listener();
    return action;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const transport = {
    get: (workspaceId: string, agentId: string) => drafts.get(workspaceId, agentId),
    set: (...args: Parameters<DraftsClient['set']>) => drafts.set(...args),
    clear: (workspaceId: string, agentId: string) =>
      drafts.clear ? drafts.clear(workspaceId, agentId) : Promise.resolve({ ok: true as const }),
  };
  const task: Task = runSaga(
    { channel, dispatch, getState: () => ({ chatDrafts: state }) },
    chatDraftsSaga,
    transport,
  );
  const readView = (ownerId: string) =>
    selectChatDraftOwnerView.select(
      { chatDrafts: state } as Parameters<typeof selectChatDraftOwnerView.select>[0],
      ownerId,
    );
  const port: ChatDraftStorePort = {
    dispatch,
    ownerView: (ownerId) => ({
      subscribe(run) {
        const emit = () => run(readView(ownerId));
        emit();
        return subscribe(emit);
      },
    }),
  };
  return {
    get state() {
      return state;
    },
    port,
    dispatch,
    subscribe,
    stop: () => task.cancel(),
  };
}

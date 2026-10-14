import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { ChatClient, ChatTranscript } from '$lib/client/app-client';
import type { AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import { agentSessionReducer } from '../../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  chatStateReducer,
  retainedChatTranscriptsSet,
} from '../../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { createReadOnlyChatSaga } from '../../../../../../src/store/renderer/slices/chat-state/sagas/read-only-chat-saga-factory';

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
});
const workspaceId = WorkspaceId('workspace-a');
const session: AgentSession = {
  id: AgentId('agent-a'),
  workspaceId,
  backendSessionId: null,
  name: 'Existing agent',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
};
const transcript: ChatTranscript = {
  messages: [
    {
      id: 'message-1',
      role: 'assistant',
      timestamp: '2026-10-14T00:00:00Z',
      contentBlocks: [{ type: 'text', text: 'Real boundary input' }],
    },
  ],
  truncated: false,
  totalMessages: 1,
  isStreaming: false,
  fromSnapshot: true,
};
function setup(read = vi.fn(async () => session)) {
  const store = new ReactStore({
    agentSessions: agentSessionReducer,
    chatState: chatStateReducer,
    daemonHealth: daemonHealthReducer,
  });
  stops.push(store.init());
  const context = store.createSelector((state) =>
    state.daemonHealth.health === 'down' ? null : String(state.daemonHealth.connectionGeneration),
  );
  const handlers: Array<(value: ChatTranscript) => void> = [];
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const subscribe = vi.fn<ChatClient['subscribe']>((_id, callback, phase) => {
    handlers.push(callback);
    const close = vi.fn();
    closes.push(close);
    phase?.('live');
    callback(transcript);
    return close;
  });
  stops.push(
    store.runSaga(
      createReadOnlyChatSaga({
        chat: { subscribe },
        readAgentSession: read,
        contextSelector: context,
        readAdmission: () => context.select(store.state),
      }),
    ),
  );
  const connected = (value: boolean) =>
    store.dispatch(connectionStatusChanged(value ? 'connected' : 'disconnected'));
  const lease = (owner: string, ids: string[]) =>
    store.dispatch(retainedChatTranscriptsSet(owner, workspaceId, ids));
  return { store, read, subscribe, handlers, closes, connected, lease };
}
describe('read-only conversation ownership with canonical reducers', () => {
  it('shares one stream between consumers, rejects retired callbacks, and reconnects from a fresh snapshot', async () => {
    const h = setup();
    h.connected(true);
    h.lease('one', [session.id]);
    h.lease('two', [session.id]);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.transcriptHydration).toBe('settled'),
    );
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.store.state.agentSessions.byAgentId[session.id]?.messages.map((m) => m.id)).toEqual([
      'message-1',
    ]);
    h.lease('one', []);
    expect(h.closes[0]).not.toHaveBeenCalled();
    h.connected(false);
    await vi.waitFor(() => expect(h.closes[0]).toHaveBeenCalledOnce());
    h.handlers[0]?.({ ...transcript, messages: [] });
    expect(h.store.state.agentSessions.byAgentId[session.id]?.messages).toHaveLength(1);
    h.connected(true);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(2));
    h.lease('two', []);
    await vi.waitFor(() => expect(h.closes[1]).toHaveBeenCalledOnce());
    expect(h.store.state.chatState.byAgentId[session.id]?.liveStreamPhase).toBeNull();
  });
  it('never subscribes or hydrates after an in-flight session read loses its consumer', async () => {
    let resolve!: (value: AgentSession) => void;
    const h = setup(
      vi.fn(
        () =>
          new Promise<AgentSession>((done) => {
            resolve = done;
          }),
      ),
    );
    h.connected(true);
    h.lease('one', [session.id]);
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    h.lease('one', []);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.trackedWorkspaceId).toBeNull(),
    );
    resolve(session);
    await Promise.resolve();
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.store.state.agentSessions.byAgentId[session.id]).toBeUndefined();
  });
  it('does not admit a session from another workspace and permits a read-only retry', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...session, workspaceId: WorkspaceId('other') })
      .mockResolvedValue(session);
    const h = setup(read);
    h.connected(true);
    h.lease('one', [session.id]);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.transcriptHydration).toBe('error'),
    );
    expect(h.subscribe).not.toHaveBeenCalled();
    h.lease('one', [session.id]);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
  });
});

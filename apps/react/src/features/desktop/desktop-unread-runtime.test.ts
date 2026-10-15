import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentSession, Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '@/store';
import { desktopUnreadTrackingSaga } from './desktop-unread-runtime';
import { agentReadOwnership } from '@/features/agent/agent-read-service';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { getPrincipalActionContext } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  replaceMessages,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { markAgentAsViewed } from '../../../../../src/store/renderer/slices/unread-tracking/unread-tracking-slice';
import { principalContextChanged } from '../../../../../src/store/renderer/slices/principal/principal-slice';
import { connectionStatusChanged } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';

const transport = vi.hoisted(() => ({
  request: vi.fn(),
  wire: vi.fn(),
  beforeDispatch: undefined as (() => void) | undefined,
}));
vi.mock('@/features/backend/backend-transport', () => ({
  backend: { backendRequest: transport.request },
}));
vi.mock('@/features/agent/agent-read-service', async () => {
  const { createAgentReadOwnership } =
    await import('../../../../../src/features/agent/agent-read-ownership-factory');
  const { store } = await import('@/store');
  return {
    agentReadOwnership: createAgentReadOwnership({
      onBackendReconnected: () => () => {},
      getSessionWorkspace: (id) => store.state.agentSessions.byAgentId[id]?.workspaceId,
    }),
  };
});

const reply = {
  id: 'reply',
  role: 'assistant',
  content: 'Persisted reply',
  timestamp: '',
} as AgentMessage;
const session = {
  id: 'agent',
  workspaceId: 'workspace',
  status: 'idle',
  messages: [reply],
  createdAt: '',
  updatedAt: '',
} as AgentSession;
let stop: () => void;
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  transport.wire.mockReset();
  transport.beforeDispatch = undefined;
  transport.request.mockReset().mockImplementation(async (method, params, options) => {
    transport.beforeDispatch?.();
    options?.onDispatch?.();
    transport.wire(method, params);
    return { success: true, lastSeenMessageId: params.messageId };
  });
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: 'owner' } as Workspace));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      getPrincipalActionContext(store.state),
    ),
  );
  store.dispatch(bulkUpsertSessions([session]));
  stop = store.runSaga(desktopUnreadTrackingSaga);
});
afterEach(() => {
  stop();
  dispose();
  agentReadOwnership.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const flushMarker = () => vi.advanceTimersByTimeAsync(1000);

it('routes one admitted view marker through the shared wire owner and dedupes its ack', async () => {
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledExactlyOnceWith('agent.markSeen', {
    workspaceId: 'workspace',
    agentId: 'agent',
    messageId: 'reply',
  });
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledTimes(1);
});

const retirements = [
  ['workspace admission', () => store.dispatch(setWorkspaceHasLoaded(false))],
  ['principal', () => store.dispatch(principalContextChanged(store.state.principal.context))],
  ['connection', () => store.dispatch(connectionStatusChanged('disconnected'))],
  [
    'workspace participation',
    () => store.dispatch(setWorkspaceEntity({ id: 'workspace', myRole: undefined } as Workspace)),
  ],
  [
    'agent workspace',
    () =>
      store.dispatch(bulkUpsertSessions([{ ...session, workspaceId: WorkspaceId('elsewhere') }])),
  ],
  ['agent read ownership', () => agentReadOwnership.invalidate()],
] as const;
it.each(retirements)('drops a scheduled view after %s changes', async (_name, retire) => {
  store.dispatch(markAgentAsViewed('agent'));
  retire();
  await flushMarker();
  expect(transport.wire).not.toHaveBeenCalled();
});
it.each(retirements)('checks %s again at final transport dispatch', async (_name, retire) => {
  transport.beforeDispatch = retire;
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.request).toHaveBeenCalledTimes(1);
  expect(transport.wire).not.toHaveBeenCalled();
});

it('cancels its pending timer when the root saga stops', async () => {
  store.dispatch(markAgentAsViewed('agent'));
  stop();
  await flushMarker();
  expect(transport.wire).not.toHaveBeenCalled();
  stop = store.runSaga(desktopUnreadTrackingSaga);
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledTimes(1);
});

it('releases the empty-transcript rearm on root cancellation', async () => {
  store.dispatch(replaceMessages('agent', []));
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  stop();
  stop = store.runSaga(desktopUnreadTrackingSaga);
  store.dispatch(replaceMessages('agent', [reply]));
  await flushMarker();
  expect(transport.wire).not.toHaveBeenCalled();
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledTimes(1);
});

it('retries a rejected marker and allows the same marker in a new agent ownership lifetime', async () => {
  transport.request.mockRejectedValueOnce(new Error('not found'));
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).not.toHaveBeenCalled();
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledTimes(1);
  agentReadOwnership.invalidate();
  store.dispatch(markAgentAsViewed('agent'));
  await flushMarker();
  expect(transport.wire).toHaveBeenCalledTimes(2);
});

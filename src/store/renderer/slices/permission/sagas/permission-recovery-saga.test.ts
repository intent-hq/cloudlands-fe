import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  initialState,
  permissionRequestReceived,
  removePermissionRequest,
  setPendingRequests,
} from '../permission-slice';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: request }));
import { recoverPendingPermissions } from './permission-recovery-saga';
const prompt = {
  requestId: 'p1',
  sessionId: 'a1',
  title: 'Allow tool',
  options: [{ id: 'allow', label: 'Allow' }],
  timestamp: 1,
};
function fixture() {
  const state = withLegacyPrincipal({
    permission: initialState,
    workspace: { workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner' }]) },
    agentSessions: { byAgentId: { a1: { id: 'a1', workspaceId: 'ws' } } },
  });
  const channel = stdChannel(),
    dispatch = vi.fn();
  return {
    state,
    channel,
    dispatch,
    start: () => runSaga({ channel, dispatch, getState: () => state }, recoverPendingPermissions),
  };
}
describe('current prompt recovery wire contract', () => {
  it('reads exact per-agent pending prompts and binds the known workspace', async () => {
    request.mockResolvedValue({ requests: [prompt] });
    const f = fixture();
    await f.start().toPromise();
    expect(request).toHaveBeenLastCalledWith('agent.pendingPermissions', { agentId: 'a1' });
    expect(f.dispatch).toHaveBeenCalledWith(setPendingRequests([{ ...prompt, workspaceId: 'ws' }]));
  });
  it('does not resurrect a prompt resolved before its list reply', async () => {
    let resolve!: (x: unknown) => void;
    request.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const f = fixture();
    const task = f.start();
    f.channel.put(removePermissionRequest('p1'));
    resolve({ requests: [prompt] });
    await task.toPromise();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('rejects an old-generation response and a current guest without management rights', async () => {
    let resolve!: (x: unknown) => void;
    request.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const f = fixture();
    const task = f.start();
    f.state.principal.status = 'loading';
    resolve({ requests: [prompt] });
    await task.toPromise();
    expect(f.dispatch).not.toHaveBeenCalled();
    const g = fixture();
    g.state.principal.snapshot!.capabilities.hostMembership = true;
    g.state.principal.snapshot!.principal.hostRole = 'guest';
    request.mockClear();
    await g.start().toPromise();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('held multi-agent recovery', () => {
  it('keeps pending A when unrelated B arrives and excludes only A resolved during the read', async () => {
    let resolve!: (x: unknown) => void;
    request.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const f = fixture();
    const task = f.start();
    f.channel.put(permissionRequestReceived({ ...prompt, requestId: 'b', sessionId: 'b' }));
    f.channel.put(removePermissionRequest('resolved-a'));
    resolve({ requests: [prompt, { ...prompt, requestId: 'resolved-a' }] });
    await task.toPromise();
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith(
      setPendingRequests([{ ...prompt, workspaceId: 'ws' }]),
    );
  });
});

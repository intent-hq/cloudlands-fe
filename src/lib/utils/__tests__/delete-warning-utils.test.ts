import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

// FAKE daemon transport: getActiveHookNames' `hook.list` fallback bottoms out
// here so the exact JSON-RPC method + params can be asserted per PROTOCOL.md
// §5.40. The slice branch runs against the REAL configured store.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';
import { getActiveHookNames } from '../delete-warning-utils';
import { store as appStore } from '$store/renderer/store';
import {
  backgroundHooksCleared,
  backgroundHooksUpdated,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';

const WS = 'ws-hooks-test';

function makeHook(
  hookId: string,
  state: BackgroundHook['state'],
  name = `hook ${hookId}`,
): BackgroundHook {
  return {
    hookId,
    workspaceId: WS,
    agentId: 'agent-1',
    name,
    delayMs: 60000,
    state,
    createdAt: '2026-08-04T00:00:00.000Z',
    runCount: 0,
  };
}

describe('getActiveHookNames', () => {
  let backend: MockBackendHandle;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    backend = installMockBackend();
  });

  afterEach(() => {
    appStore.dispatch(backgroundHooksCleared(WS));
    resetMockBackend();
  });

  // Store init fires unrelated startup requests; only `hook.list` matters here.
  const hookListRequests = () => backend.requests.filter((r) => r.method === 'hook.list');

  it('reads the slice when a live subscription entry exists — no hook.list call', async () => {
    appStore.dispatch(
      backgroundHooksUpdated(WS, [
        makeHook('hook-1', 'scheduled', 'ci watch'),
        makeHook('hook-2', 'running', 'pr checks'),
        makeHook('hook-3', 'dispatched'),
      ]),
    );

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['ci watch', 'pr checks']);
    expect(hookListRequests()).toHaveLength(0);
  });

  it('uses the slice even when its hook list is empty', async () => {
    appStore.dispatch(backgroundHooksUpdated(WS, []));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual([]);
    expect(hookListRequests()).toHaveLength(0);
  });

  it('falls back to hook.list when no subscription entry exists, sending the §5.40 request', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [makeHook('hook-1', 'scheduled', 'ci watch'), makeHook('hook-2', 'cancelled')],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['ci watch']);
    expect(hookListRequests()).toEqual([{ method: 'hook.list', params: { workspaceId: WS } }]);
  });

  it('counts only scheduled/running states as active', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [
        makeHook('hook-1', 'scheduled'),
        makeHook('hook-2', 'running'),
        makeHook('hook-3', 'dispatched'),
        makeHook('hook-4', 'evicted'),
        makeHook('hook-5', 'cancelled'),
        // Terminal v3.1 state not yet in the BackgroundHook union
        // (pre-existing gap); inactive either way.
        makeHook('hook-6', 'expired' as BackgroundHook['state']),
      ],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['hook hook-1', 'hook hook-2']);
  });

  it('falls back to a truncated hookId when a hook has no name', async () => {
    backend.onRequest('hook.list', () => ({
      hooks: [{ ...makeHook('abcdefgh-1234-5678', 'running'), name: '' }],
    }));

    const names = await getActiveHookNames(WS);

    expect(names).toEqual(['abcdefgh']);
  });

  it('fails open (returns []) when hook.list rejects, so archive/delete is not blocked', async () => {
    backend.onRequest('hook.list', () => {
      throw new Error('daemon unavailable');
    });

    const names = await getActiveHookNames(WS);

    expect(names).toEqual([]);
    expect(hookListRequests()).toEqual([{ method: 'hook.list', params: { workspaceId: WS } }]);
  });
});

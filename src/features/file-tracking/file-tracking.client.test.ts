/**
 * File-tracking client wire contract (PROTOCOL §5.19 `file-tracking.getLineStats`
 * / `file-tracking.getAgentLocks`).
 *
 * FAKE transport only: `backendRequest` is mocked, so no request reaches a
 * real daemon. Asserts the exact JSON-RPC method + params and the
 * fold-to-zeros error behavior the title-bar badge relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

const admission = vi.hoisted(() => ({
  role: 'owner' as string | null,
  context: 'owner-1' as string | null,
  loaded: 'owner-1',
  exists: true,
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectHostRole: { select: () => admission.role },
  selectPrincipalAdmissionContext: { select: () => admission.context },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => (admission.exists ? { id: 'ws-abc' } : undefined) },
  selectWorkspaceListLoadedForBackend: { select: () => admission.loaded === admission.context },
}));

const { dispatchSpy } = vi.hoisted(() => ({ dispatchSpy: vi.fn() }));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: dispatchSpy,
    get state() {
      return {
        workspace: { loadedPrincipalContext: admission.loaded },
        connections: { windowBackendId: 'local' },
      };
    },
  },
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { getLineStats, hydrateAgentLocks, toLockRecord } from './file-tracking.client';

const mockedRequest = vi.mocked(backendRequest);

describe('file-tracking client (§5.19 getLineStats, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('forwards file-tracking.getLineStats and maps { additions, deletions }', async () => {
    mockedRequest.mockResolvedValueOnce({ additions: 42, deletions: 7 });

    const stats = await getLineStats('ws-abc');

    expect(mockedRequest).toHaveBeenCalledWith('file-tracking.getLineStats', {
      workspaceId: 'ws-abc',
    });
    expect(stats).toEqual({ additions: 42, deletions: 7 });
  });

  it('folds a malformed payload to zeros', async () => {
    mockedRequest.mockResolvedValueOnce({ additions: 'nope' });

    expect(await getLineStats('ws-abc')).toEqual({ additions: 0, deletions: 0 });
  });

  it('folds transport errors to zeros (badge is informational)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon down'));

    expect(await getLineStats('ws-abc')).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('file-tracking client (§5.19 getAgentLocks hydration, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('forwards file-tracking.getAgentLocks and folds arrays into the lock records', async () => {
    mockedRequest.mockResolvedValueOnce({
      autoCommitEnabled: true,
      lockedAgentIds: ['agent-a', 'agent-b'],
      lockedFilePaths: ['src/a.ts'],
    });

    await hydrateAgentLocks('ws-abc');

    expect(mockedRequest).toHaveBeenCalledWith('file-tracking.getAgentLocks', {
      workspaceId: 'ws-abc',
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      setAgentLockState('ws-abc', { 'agent-a': true, 'agent-b': true }, { 'src/a.ts': true }),
    );
  });

  it('folds a malformed payload to empty (unlocked) records', async () => {
    mockedRequest.mockResolvedValueOnce({ lockedAgentIds: 'nope' });

    await hydrateAgentLocks('ws-abc');

    expect(dispatchSpy).toHaveBeenCalledWith(setAgentLockState('ws-abc', {}, {}));
  });

  it('degrades transport errors to unlocked (empty records) so stale locks never persist', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon down'));

    await hydrateAgentLocks('ws-abc');

    expect(dispatchSpy).toHaveBeenCalledWith(setAgentLockState('ws-abc', {}, {}));
  });
});

describe('toLockRecord', () => {
  it('folds a string[] into Record<string, true> and skips non-strings', () => {
    expect(toLockRecord(['a', 42, 'b', null])).toEqual({ a: true, b: true });
    expect(toLockRecord(undefined)).toEqual({});
    expect(toLockRecord('not-an-array')).toEqual({});
  });
});

describe('caller admission regression: locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admission.role = 'owner';
    admission.context = 'owner-1';
    admission.loaded = 'owner-1';
    admission.exists = true;
  });
  afterEach(() => {
    admission.role = 'owner';
    admission.context = 'owner-1';
    admission.loaded = 'owner-1';
  });
  it('does not issue a Member-only read for an admitted Guest', async () => {
    admission.role = 'guest';
    mockedRequest.mockResolvedValue({ lockedAgentIds: [] });
    await hydrateAgentLocks('ws-abc');
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('M workspace lock caller fences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admission.role = 'owner';
    admission.context = 'owner-1';
    admission.loaded = 'owner-1';
    admission.exists = true;
  });
  afterEach(() => {
    admission.role = 'owner';
    admission.context = 'owner-1';
    admission.loaded = 'owner-1';
    admission.exists = true;
  });
  it.each(['owner', 'member'])('M17 permits %s without management or Labs', async (role) => {
    admission.role = role;
    mockedRequest.mockResolvedValue({ lockedAgentIds: ['held'] });
    await hydrateAgentLocks('ws-abc');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
  it.each(['unknown', 'absent', 'stale-list', 'guest-owner'] as const)(
    'M18 refuses %s before issuing',
    async (kind) => {
      if (kind === 'unknown') admission.context = null;
      if (kind === 'absent') admission.exists = false;
      if (kind === 'stale-list') admission.loaded = 'old';
      if (kind === 'guest-owner') admission.role = 'guest';
      await hydrateAgentLocks('ws-abc');
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'M19 joins held read rejected=%s but cannot publish after admission changed',
    async (rejects) => {
      let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
      mockedRequest.mockReturnValue(
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      const original = hydrateAgentLocks('ws-abc');
      admission.context = 'owner-2';
      if (rejects) reject(new Error('same original refusal'));
      else resolve({ lockedAgentIds: ['old'] });
      await original;
      expect(mockedRequest).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).not.toHaveBeenCalled();
    },
  );
});

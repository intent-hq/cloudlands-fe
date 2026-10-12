import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNoteWorkspaceDiscovery } from './backend-note-workspace-discovery';
import type { BackendTransport } from './backend-transport-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture() {
  const request = vi.fn<BackendTransport['request']>();
  const enumerate = vi.fn<(tag: string) => Promise<string[]>>().mockResolvedValue(['ws-a']);
  const discovery = createNoteWorkspaceDiscovery({
    // Scripted responses cross only the declared generic request boundary.
    backendRequest: <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
      request(...args) as Promise<T>,
    listWorkspaceIdsOrThrow: enumerate,
  });
  return { request, enumerate, discovery };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('canonical note workspace discovery', () => {
  it('does no I/O at construction and resolves a synchronous discovery without scanning', async () => {
    const { request, enumerate, discovery } = fixture();
    expect(request).not.toHaveBeenCalled();
    expect(enumerate).not.toHaveBeenCalled();
    discovery.rememberNoteWorkspace('note-a', 'ws-a');
    await expect(discovery.resolveNoteWorkspaceId('note-a')).resolves.toBe('ws-a');
    expect(request).not.toHaveBeenCalled();
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('keeps a complete miss for five seconds, then retries the real scan', async () => {
    vi.useFakeTimers();
    const { request, enumerate, discovery } = fixture();
    request.mockResolvedValueOnce({ notes: [] });
    await expect(discovery.resolveNoteWorkspaceId('late')).resolves.toBeNull();
    vi.advanceTimersByTime(4_999);
    await expect(discovery.resolveNoteWorkspaceId('late')).resolves.toBeNull();
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
    vi.advanceTimersByTime(1);
    request.mockResolvedValueOnce({ notes: [{ id: 'late' }] });
    await expect(discovery.resolveNoteWorkspaceId('late')).resolves.toBe('ws-a');
    expect(enumerate.mock.calls).toEqual([['resolver'], ['resolver']]);
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
  });

  it('coalesces simultaneous misses into one scan and shares the resulting discovery', async () => {
    const { request, enumerate, discovery } = fixture();
    const started = deferred<void>();
    const response = deferred<unknown>();
    request.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const first = discovery.resolveNoteWorkspaceId('shared');
    const second = discovery.resolveNoteWorkspaceId('shared');
    try {
      await started.promise;
      expect(enumerate.mock.calls).toEqual([['resolver']]);
      expect(request.mock.calls).toEqual([
        ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ]);
      response.resolve({ notes: [{ id: 'shared' }] });
      await expect(Promise.all([first, second])).resolves.toEqual(['ws-a', 'ws-a']);
      await expect(discovery.resolveNoteWorkspaceId('shared')).resolves.toBe('ws-a');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve({ notes: [] });
      await Promise.all([first, second]);
    }
  });

  it('lets a discovery unblock a previously negative resolution without waiting for expiry', async () => {
    vi.useFakeTimers();
    const { request, discovery } = fixture();
    request.mockResolvedValueOnce({ notes: [] });
    await expect(discovery.resolveNoteWorkspaceId('arrives')).resolves.toBeNull();
    discovery.rememberNoteWorkspace('arrives', 'ws-b');
    await expect(discovery.resolveNoteWorkspaceId('arrives')).resolves.toBe('ws-b');
    expect(request).toHaveBeenCalledTimes(1);
    // This public outcome proves routing, not visibility into the private negative map.
  });

  it('retries failed enumeration rather than recording a negative miss', async () => {
    const { request, enumerate, discovery } = fixture();
    enumerate.mockRejectedValueOnce(new Error('enumeration unavailable'));
    await expect(discovery.resolveNoteWorkspaceId('retry')).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ notes: [{ id: 'retry' }] });
    await expect(discovery.resolveNoteWorkspaceId('retry')).resolves.toBe('ws-a');
    expect(enumerate.mock.calls).toEqual([['resolver'], ['resolver']]);
  });

  it('does not treat an empty enumeration as a complete negative scan', async () => {
    const { request, enumerate, discovery } = fixture();
    enumerate.mockResolvedValueOnce([]);
    await expect(discovery.resolveNoteWorkspaceId('new-workspace')).resolves.toBeNull();
    request.mockResolvedValueOnce({ notes: [{ id: 'new-workspace' }] });
    await expect(discovery.resolveNoteWorkspaceId('new-workspace')).resolves.toBe('ws-a');
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
    expect(enumerate).toHaveBeenCalledTimes(2);
  });

  it('continues after a failed workspace and does not cache an incomplete miss', async () => {
    const { request, enumerate, discovery } = fixture();
    enumerate.mockResolvedValue(['ws-a', 'ws-b']);
    request
      .mockRejectedValueOnce(new Error('ws-a unavailable'))
      .mockResolvedValueOnce({ notes: [] })
      .mockResolvedValueOnce({ notes: [{ id: 'retry' }] });
    await expect(discovery.resolveNoteWorkspaceId('retry')).resolves.toBeNull();
    await expect(discovery.resolveNoteWorkspaceId('retry')).resolves.toBe('ws-a');
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-b', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
  });

  it('retries a projection rejection once without the projection field', async () => {
    const { request, discovery } = fixture();
    request
      .mockRejectedValueOnce(Object.assign(new Error('Invalid params'), { rpcCode: -32602 }))
      .mockResolvedValueOnce({ notes: [{ id: 'legacy' }] });
    await expect(discovery.resolveNoteWorkspaceId('legacy')).resolves.toBe('ws-a');
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-a' }],
    ]);
  });

  it('keeps a failed projection fallback retryable', async () => {
    const { request, discovery } = fixture();
    request
      .mockRejectedValueOnce(Object.assign(new Error('Invalid params'), { rpcCode: -32602 }))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ notes: [{ id: 'legacy-retry' }] });
    await expect(discovery.resolveNoteWorkspaceId('legacy-retry')).resolves.toBeNull();
    await expect(discovery.resolveNoteWorkspaceId('legacy-retry')).resolves.toBe('ws-a');
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-a' }],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
  });

  it('does not retry an unrelated RPC rejection without projection', async () => {
    const { request, discovery } = fixture();
    request.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { rpcCode: -32003 }));
    await expect(discovery.resolveNoteWorkspaceId('forbidden')).resolves.toBeNull();
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);
  });

  it('catches a synchronous request error and leaves the next resolution retryable', async () => {
    const { request, discovery } = fixture();
    request.mockImplementationOnce(() => {
      throw new Error('capability unavailable');
    });
    await expect(discovery.resolveNoteWorkspaceId('recovered')).resolves.toBeNull();
    request.mockResolvedValueOnce({ notes: [{ id: 'recovered' }] });
    await expect(discovery.resolveNoteWorkspaceId('recovered')).resolves.toBe('ws-a');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('remembers other notes encountered before finding the requested note', async () => {
    const { request, enumerate, discovery } = fixture();
    enumerate.mockResolvedValue(['ws-a', 'ws-b']);
    request
      .mockResolvedValueOnce({ notes: [{ id: 'neighbor' }] })
      .mockResolvedValueOnce({ notes: [{ id: 'target' }] });
    await expect(discovery.resolveNoteWorkspaceId('target')).resolves.toBe('ws-b');
    await expect(discovery.resolveNoteWorkspaceId('neighbor')).resolves.toBe('ws-a');
    expect(enumerate).toHaveBeenCalledTimes(1);
    expect(request.mock.calls).toEqual([
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['note.list', { workspaceId: 'ws-b', projection: 'slim' }],
    ]);
  });

  it('preserves the positive index while the test hook clears negative misses', async () => {
    vi.useFakeTimers();
    const { request, enumerate, discovery } = fixture();
    request.mockResolvedValueOnce({ notes: [] });
    await discovery.resolveNoteWorkspaceId('missing');
    discovery.rememberNoteWorkspace('known', 'ws-b');
    discovery.resetTransientCachesForTests();
    await expect(discovery.resolveNoteWorkspaceId('known')).resolves.toBe('ws-b');
    request.mockResolvedValueOnce({ notes: [{ id: 'missing' }] });
    await expect(discovery.resolveNoteWorkspaceId('missing')).resolves.toBe('ws-a');
    expect(enumerate).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('lets the test reset detach an existing scan without cancelling its result', async () => {
    const { request, enumerate, discovery } = fixture();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    request
      .mockImplementationOnce(() => {
        firstStarted.resolve();
        return firstResponse.promise;
      })
      .mockImplementationOnce(() => {
        secondStarted.resolve();
        return secondResponse.promise;
      });
    const first = discovery.resolveNoteWorkspaceId('reset-pending');
    let second: Promise<string | null> | undefined;
    try {
      await firstStarted.promise;
      discovery.resetTransientCachesForTests();
      second = discovery.resolveNoteWorkspaceId('reset-pending');
      await secondStarted.promise;
      expect(enumerate).toHaveBeenCalledTimes(2);
      expect(request.mock.calls).toEqual([
        ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
        ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ]);
      firstResponse.resolve({ notes: [] });
      await expect(first).resolves.toBeNull();
      secondResponse.resolve({ notes: [{ id: 'reset-pending' }] });
      await expect(second).resolves.toBe('ws-a');
    } finally {
      firstResponse.resolve({ notes: [] });
      secondResponse.resolve({ notes: [] });
      await Promise.all([first, second]);
    }
  });

  it('preserves last-writer-wins and ignores empty discovery keys', async () => {
    const { request, enumerate, discovery } = fixture();
    discovery.rememberNoteWorkspace('shared-id', 'ws-a');
    discovery.rememberNoteWorkspace('shared-id', 'ws-b');
    discovery.rememberNoteWorkspace('shared-id', '');
    discovery.rememberNoteWorkspace('', 'ws-c');
    await expect(discovery.resolveNoteWorkspaceId('shared-id')).resolves.toBe('ws-b');
    request.mockResolvedValueOnce({ notes: [] });
    await expect(discovery.resolveNoteWorkspaceId('')).resolves.toBeNull();
    expect(enumerate).toHaveBeenCalledTimes(1);
  });

  it('characterizes an older in-flight scan overwriting a later discovery', async () => {
    const { request, discovery } = fixture();
    const started = deferred<void>();
    const response = deferred<unknown>();
    request.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const pending = discovery.resolveNoteWorkspaceId('raced');
    try {
      await started.promise;
      discovery.rememberNoteWorkspace('raced', 'ws-b');
      await expect(discovery.resolveNoteWorkspaceId('raced')).resolves.toBe('ws-b');
      response.resolve({ notes: [{ id: 'raced' }] });
      await expect(pending).resolves.toBe('ws-a');
      await expect(discovery.resolveNoteWorkspaceId('raced')).resolves.toBe('ws-a');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve({ notes: [] });
      await pending;
    }
  });

  it('isolates positive, negative and in-flight discoveries between factory instances', async () => {
    vi.useFakeTimers();
    const first = fixture();
    const second = fixture();
    first.enumerate.mockResolvedValue(['ws-first']);
    second.enumerate.mockResolvedValue(['ws-second']);
    const firstStarted = deferred<void>();
    const firstResponse = deferred<unknown>();
    let firstPending: Promise<string | null> | undefined;
    let secondPending: Promise<string | null> | undefined;
    try {
      first.discovery.rememberNoteWorkspace('positive-only', 'ws-first');
      second.request.mockResolvedValueOnce({ notes: [] });
      await expect(second.discovery.resolveNoteWorkspaceId('positive-only')).resolves.toBeNull();
      await expect(first.discovery.resolveNoteWorkspaceId('positive-only')).resolves.toBe(
        'ws-first',
      );
      expect(first.enumerate).not.toHaveBeenCalled();

      first.request.mockResolvedValueOnce({ notes: [] });
      await expect(first.discovery.resolveNoteWorkspaceId('negative-only')).resolves.toBeNull();
      second.request.mockResolvedValueOnce({ notes: [{ id: 'negative-only' }] });
      await expect(second.discovery.resolveNoteWorkspaceId('negative-only')).resolves.toBe(
        'ws-second',
      );
      await expect(first.discovery.resolveNoteWorkspaceId('negative-only')).resolves.toBeNull();

      first.request.mockImplementationOnce(() => {
        firstStarted.resolve();
        return firstResponse.promise;
      });
      firstPending = first.discovery.resolveNoteWorkspaceId('in-flight');
      await firstStarted.promise;
      second.request.mockResolvedValueOnce({ notes: [{ id: 'in-flight' }] });
      secondPending = second.discovery.resolveNoteWorkspaceId('in-flight');
      // Resume the second fulfilled enumeration, without waiting on the held first scan.
      await Promise.resolve();
      expect(second.request.mock.calls).toEqual([
        ['note.list', { workspaceId: 'ws-second', projection: 'slim' }],
        ['note.list', { workspaceId: 'ws-second', projection: 'slim' }],
        ['note.list', { workspaceId: 'ws-second', projection: 'slim' }],
      ]);
      await expect(secondPending).resolves.toBe('ws-second');
      firstResponse.resolve({ notes: [{ id: 'in-flight' }] });
      await expect(firstPending).resolves.toBe('ws-first');
      await expect(second.discovery.resolveNoteWorkspaceId('in-flight')).resolves.toBe('ws-second');
      expect(first.request.mock.calls).toEqual([
        ['note.list', { workspaceId: 'ws-first', projection: 'slim' }],
        ['note.list', { workspaceId: 'ws-first', projection: 'slim' }],
      ]);
      expect(first.enumerate.mock.calls).toEqual([['resolver'], ['resolver']]);
      expect(second.enumerate.mock.calls).toEqual([['resolver'], ['resolver'], ['resolver']]);
    } finally {
      firstResponse.resolve({ notes: [] });
      await Promise.all([firstPending, secondPending]);
    }
  });
});

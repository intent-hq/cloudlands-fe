import { describe, expect, it, vi } from 'vitest';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';
import fixture from '$shared/types/__fixtures__/native-review-v1.json';
import {
  createRepositoryRequestRoutes,
  type RepositoryOperationCompletion,
  type RepositoryRequestBinding,
  type RepositoryRequestRouteSources,
} from './repository-request-route';

type Sender = { id: number };
type Client = { name: string };
const root: RepositoryRootIdentity = { workspaceId: 'same-workspace', kind: 'primary' };
const rootKey = (value: RepositoryRootIdentity) => JSON.stringify(value);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const hostWindow = { id: 1 };
  const localWindow = { id: 2 };
  const peerWindow = { id: 3 };
  const hostClient = { name: 'host-A' };
  const localClient = { name: 'local-B' };
  const bindings = new Map<Sender, { window: object; stamp: object; backendId: string }>([
    [hostWindow, { window: {}, stamp: {}, backendId: 'host-A' }],
    [localWindow, { window: {}, stamp: {}, backendId: 'local-B' }],
    [peerWindow, { window: {}, stamp: {}, backendId: 'host-A' }],
  ]);
  const backends = new Map<string, { client: Client; incarnation: object; connected: boolean }>([
    ['host-A', { client: hostClient, incarnation: {}, connected: true }],
    ['local-B', { client: localClient, incarnation: {}, connected: true }],
  ]);
  const lifetimes = new Map<Sender, Map<string, object>>([
    [hostWindow, new Map([[rootKey(root), {}]])],
    [localWindow, new Map([[rootKey(root), {}]])],
    [peerWindow, new Map([[rootKey(root), {}]])],
  ]);
  const sources: RepositoryRequestRouteSources<Sender, Client> = {
    readSenderBinding: vi.fn((sender) => bindings.get(sender) ?? null),
    readBackend: vi.fn((id) => backends.get(id) ?? null),
    readRepositoryLifetime: vi.fn(
      (sender, requestedRoot) => lifetimes.get(sender)?.get(rootKey(requestedRoot)) ?? null,
    ),
  };
  const routes = createRepositoryRequestRoutes(sources);
  const capture = () => routes.captureRepositoryRequestBinding(hostWindow, root);
  const rotateLifetime = () => lifetimes.get(hostWindow)?.set(rootKey(root), {});
  return {
    hostWindow,
    localWindow,
    peerWindow,
    hostClient,
    localClient,
    bindings,
    backends,
    lifetimes,
    sources,
    routes,
    capture,
    rotateLifetime,
  };
}

describe('captured repository routes', () => {
  it('uses each explicit window backend even with identical workspace IDs', async () => {
    const h = setup();
    const host = h.capture();
    const local = h.routes.captureRepositoryRequestBinding(h.localWindow, root);
    const send = vi.fn(async (client: Client, requestedRoot: Readonly<RepositoryRootIdentity>) => ({
      client,
      requestedRoot,
    }));
    const a = await h.routes.backendRequestForCapturedBinding(h.hostWindow, host, send);
    const b = await h.routes.backendRequestForCapturedBinding(h.localWindow, local, send);
    expect(send.mock.calls).toEqual([
      [h.hostClient, root],
      [h.localClient, root],
    ]);
    expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, host, a)).toEqual({
      status: 'fulfilled',
      value: { client: h.hostClient, requestedRoot: root },
    });
    expect(h.routes.readRetainedRepositoryOperation(h.localWindow, local, b)).toEqual({
      status: 'fulfilled',
      value: { client: h.localClient, requestedRoot: root },
    });
  });

  it('does not expose route data in a handle or accept serialized/spread copies', async () => {
    const h = setup();
    const binding = h.capture();
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Reflect.ownKeys(binding)).toEqual([]);
    expect(JSON.stringify(binding)).toBe('{}');
    for (const forged of [
      null,
      'host-A',
      {},
      { ...binding },
      JSON.parse(JSON.stringify(binding)),
    ]) {
      const send = vi.fn();
      expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, forged)).toBe(false);
      await expect(
        h.routes.backendRequestForCapturedBinding(h.hostWindow, forged, send),
      ).rejects.toThrow('route is unavailable');
      expect(send).not.toHaveBeenCalled();
    }
    expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, binding)).toBe(true);
  });

  it('rejects a genuine handle from another route manager', async () => {
    const h = setup();
    const foreign = createRepositoryRequestRoutes(h.sources).captureRepositoryRequestBinding(
      h.hostWindow,
      root,
    );
    const send = vi.fn();
    await expect(
      h.routes.backendRequestForCapturedBinding(h.hostWindow, foreign, send),
    ).rejects.toThrow('route is unavailable');
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['local', 'peer', 'reused-id'] as const)(
    'rejects the wrong sender (%s) without retiring the rightful owner',
    async (kind) => {
      const h = setup();
      const binding = h.capture();
      const sender =
        kind === 'local' ? h.localWindow : kind === 'peer' ? h.peerWindow : { id: h.hostWindow.id };
      const send = vi.fn();
      expect(h.routes.retireRepositoryRequestBinding(sender, binding)).toBe(false);
      await expect(
        h.routes.backendRequestForCapturedBinding(sender, binding, send),
      ).rejects.toThrow('route is unavailable');
      expect(send).not.toHaveBeenCalled();
      expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, binding)).toBe(true);
    },
  );

  it.each(['sender', 'backend', 'disconnected', 'lifetime', 'incarnation'] as const)(
    'fails capture without a usable %s and never selects local instead',
    (missing) => {
      const h = setup();
      if (missing === 'sender') h.bindings.delete(h.hostWindow);
      if (missing === 'backend') h.backends.delete('host-A');
      if (missing === 'disconnected') h.backends.get('host-A')!.connected = false;
      if (missing === 'lifetime') h.lifetimes.delete(h.hostWindow);
      if (missing === 'incarnation') {
        h.backends.get('host-A')!.incarnation = null as unknown as object;
      }
      expect(h.capture).toThrow('route is unavailable');
      expect(h.sources.readBackend).not.toHaveBeenCalledWith('local-B');
    },
  );

  it('captures a registered root by value rather than using later mutable selection', async () => {
    const h = setup();
    const registered: RepositoryRootIdentity = {
      workspaceId: root.workspaceId,
      kind: 'registered',
      gitRootId: 'root-A',
    };
    h.lifetimes.get(h.hostWindow)!.set(rootKey(registered), {});
    const binding = h.routes.captureRepositoryRequestBinding(h.hostWindow, registered);
    registered.gitRootId = 'root-B';
    const send = vi.fn(
      async (_client: Client, selected: Readonly<RepositoryRootIdentity>) => selected,
    );
    const completion = await h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
    expect(send.mock.calls[0]?.[1]).toEqual({ ...registered, gitRootId: 'root-A' });
    expect(Object.isFrozen(send.mock.calls[0]?.[1])).toBe(true);
    expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion)).toEqual({
      status: 'fulfilled',
      value: { ...registered, gitRootId: 'root-A' },
    });
  });

  it.each([
    'window',
    'stamp',
    'backend',
    'client',
    'incarnation',
    'lifetime',
    'disconnect',
  ] as const)('rejects queued work after %s changes without rebinding', async (change) => {
    const h = setup();
    const binding = h.capture();
    const send = vi.fn();
    const queued = () => h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
    const window = h.bindings.get(h.hostWindow)!;
    const backend = h.backends.get('host-A')!;
    if (change === 'window') window.window = {};
    if (change === 'stamp') window.stamp = {};
    if (change === 'backend') window.backendId = 'local-B';
    if (change === 'client') backend.client = { name: 'replacement-A' };
    if (change === 'incarnation') backend.incarnation = {}; // same client object reconnects
    if (change === 'lifetime') h.rotateLifetime();
    if (change === 'disconnect') backend.connected = false;
    await expect(queued()).rejects.toThrow('route is unavailable');
    expect(send).not.toHaveBeenCalled();
    expect(h.sources.readBackend).not.toHaveBeenCalledWith('local-B');
  });

  it('detects a reconnect entirely between reads even when the client object is unchanged', async () => {
    const h = setup();
    const binding = h.capture();
    const backend = h.backends.get('host-A')!;
    backend.connected = false;
    backend.incarnation = {};
    backend.connected = true;
    const send = vi.fn();
    await expect(
      h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send),
    ).rejects.toThrow('route is unavailable');
    expect(backend.client).toBe(h.hostClient);
    expect(send).not.toHaveBeenCalled();
  });

  it('permanently retires an observed disconnect, even if a bad producer restores old stamps', () => {
    const h = setup();
    const binding = h.capture();
    h.backends.get('host-A')!.connected = false;
    expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, binding)).toBe(false);
    h.backends.get('host-A')!.connected = true;
    expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, binding)).toBe(false);
    expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, h.capture())).toBe(true);
  });

  it('runs an unchanged queued operation on the original captured client', async () => {
    const h = setup();
    const binding = h.capture();
    const send = vi.fn(async () => 'sent');
    await Promise.resolve();
    await h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
    expect(send).toHaveBeenCalledExactlyOnceWith(h.hostClient, root);
  });

  it('ignores a backend ID smuggled into the root payload', async () => {
    const h = setup();
    const selected = { ...root, backendId: 'local-B' };
    const binding = h.routes.captureRepositoryRequestBinding(h.hostWindow, selected);
    const send = vi.fn(async () => 'sent');
    await h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
    expect(send).toHaveBeenCalledExactlyOnceWith(h.hostClient, root);
    expect(h.sources.readBackend).not.toHaveBeenCalledWith('local-B');
  });

  it.each(['sender', 'backend', 'lifetime'] as const)(
    'fails closed if the %s reader throws',
    (kind) => {
      const h = setup();
      const binding = h.capture();
      const reader =
        kind === 'sender'
          ? h.sources.readSenderBinding
          : kind === 'backend'
            ? h.sources.readBackend
            : h.sources.readRepositoryLifetime;
      vi.mocked(reader).mockImplementation(() => {
        throw new Error('unavailable trusted source');
      });
      expect(h.routes.isCapturedRepositoryRequestCurrent(h.hostWindow, binding)).toBe(false);
      expect(h.capture).toThrow('route is unavailable');
    },
  );
});

describe('repository operation completions', () => {
  it('keeps completed stages in a failed native response without synthesizing success', async () => {
    const h = setup();
    const binding = h.capture();
    const value = {
      ...fixture.execute,
      success: false,
      error: 'Create failed after commit',
      reviewExecution: {
        ...fixture.execute.reviewExecution,
        gitReceipts: [{ stage: 'commit', commitHash: 'completed-B' }],
        outcome: { status: 'failed', stage: 'create-pr', code: null, message: 'Create failed' },
      },
    };
    const completion = await h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      async () => value,
    );
    const apply = vi.fn();
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
    ).toBe(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ status: 'fulfilled', value });
    expect(apply.mock.calls[0]?.[0].value.success).toBe(false);
    expect(apply.mock.calls[0]?.[0].value.reviewExecution.gitReceipts).toEqual(
      value.reviewExecution.gitReceipts,
    );
  });

  it('applies an eligible result once and keeps its exact legacy/native payload', async () => {
    const h = setup();
    const binding = h.capture();
    const value = fixture.execute;
    const completion = await h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      async () => value,
    );
    expect(Reflect.ownKeys(completion)).toEqual([]);
    expect(JSON.stringify(completion)).toBe('{}');
    const apply = vi.fn();
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
    ).toBe(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ status: 'fulfilled', value });
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
    ).toBe(false);
    expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion)).toEqual({
      status: 'fulfilled',
      value,
    });
    expect(apply.mock.calls[0]?.[0].value).toBe(value);
  });

  it.each(['known', 'uncertain', 'thrown'] as const)(
    'retains a late %s result after retirement without applying it or retrying',
    async (kind) => {
      const h = setup();
      const binding = h.capture();
      const pending = deferred<unknown>();
      const send = vi.fn(() => pending.promise);
      const request = h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
      h.routes.retireRepositoryRequestBinding(h.hostWindow, binding);
      const value =
        kind === 'known'
          ? fixture.execute
          : {
              ...fixture.execute,
              success: false,
              reviewExecution: {
                ...fixture.execute.reviewExecution,
                outcome: { status: 'uncertain', stage: 'create-pr', message: 'Outcome unknown' },
              },
            };
      const failure = { code: -32603, data: { detail: 'Unknown result', receipt: value } };
      if (kind === 'thrown') pending.reject(failure);
      else pending.resolve(value);
      const completion = await request;
      const apply = vi.fn();
      expect(
        h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
      ).toBe(false);
      expect(apply).not.toHaveBeenCalled();
      expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion)).toEqual(
        kind === 'thrown'
          ? { status: 'rejected', reason: failure }
          : { status: 'fulfilled', value },
      );
      const nextStage = vi.fn();
      await expect(
        h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, nextStage),
      ).rejects.toThrow('route is unavailable');
      expect(send).toHaveBeenCalledOnce();
      expect(nextStage).not.toHaveBeenCalled();
    },
  );

  it('retains a disconnected original-scope response for reconciliation but not current application', async () => {
    const h = setup();
    const binding = h.capture();
    const pending = deferred<string>();
    const request = h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      () => pending.promise,
    );
    h.backends.get('host-A')!.connected = false;
    pending.resolve('completed on original host');
    const completion = await request;
    expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion)).toEqual({
      status: 'fulfilled',
      value: 'completed on original host',
    });
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, vi.fn()),
    ).toBe(false);
  });

  it.each(['backend', 'window-stamp', 'account-authority'] as const)(
    'withholds old receipts from the changed %s scope and never revives them',
    async (change) => {
      const h = setup();
      const binding = h.capture();
      const pending = deferred<object>();
      const request = h.routes.backendRequestForCapturedBinding(
        h.hostWindow,
        binding,
        () => pending.promise,
      );
      const originalWindow = { ...h.bindings.get(h.hostWindow)! };
      const originalLifetime = h.lifetimes.get(h.hostWindow)!.get(rootKey(root))!;
      if (change === 'backend') h.bindings.get(h.hostWindow)!.backendId = 'local-B';
      if (change === 'window-stamp') h.bindings.get(h.hostWindow)!.stamp = {};
      if (change === 'account-authority') h.rotateLifetime();
      pending.resolve({ privateResult: 'old account' });
      const completion = await request;
      const apply = vi.fn();
      expect(
        h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion),
      ).toBeNull();
      expect(
        h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
      ).toBe(false);
      h.bindings.set(h.hostWindow, originalWindow);
      h.lifetimes.get(h.hostWindow)!.set(rootKey(root), originalLifetime);
      expect(
        h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion),
      ).toBeNull();
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it('does not disclose receipts to other windows, captures, forged tickets or reused sender IDs', async () => {
    const h = setup();
    const binding = h.capture();
    const completion = await h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      async () => 'private',
    );
    const apply = vi.fn();
    for (const sender of [h.localWindow, h.peerWindow, { id: h.hostWindow.id }]) {
      expect(h.routes.readRetainedRepositoryOperation(sender, binding, completion)).toBeNull();
      expect(h.routes.applyRepositoryOperationCompletion(sender, binding, completion, apply)).toBe(
        false,
      );
    }
    const otherCapture = h.capture();
    expect(
      h.routes.readRetainedRepositoryOperation(h.hostWindow, otherCapture, completion),
    ).toBeNull();
    for (const ticket of [{}, { ...completion }, null]) {
      expect(
        h.routes.readRetainedRepositoryOperation(
          h.hostWindow,
          binding,
          ticket as RepositoryOperationCompletion<string>,
        ),
      ).toBeNull();
    }
    expect(
      h.routes.readRetainedRepositoryOperation(
        h.hostWindow,
        {} as RepositoryRequestBinding,
        completion,
      ),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, apply),
    ).toBe(true);
  });

  it('checks eligibility at application time, including a change after the response arrived', async () => {
    const h = setup();
    const binding = h.capture();
    const completion = await h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      async () => 'done',
    );
    h.backends.get('host-A')!.incarnation = {};
    expect(
      h.routes.applyRepositoryOperationCompletion(h.hostWindow, binding, completion, vi.fn()),
    ).toBe(false);
  });

  it('retains synchronous dispatch failures as unknown effects, not an invented empty result', async () => {
    const h = setup();
    const binding = h.capture();
    const error = new Error('Transport failed after send');
    const send = vi.fn(() => {
      throw error;
    });
    const completion = await h.routes.backendRequestForCapturedBinding(h.hostWindow, binding, send);
    expect(h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, completion)).toEqual({
      status: 'rejected',
      reason: error,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('correlates out-of-order completions with their own separate commit/create receipts', async () => {
    const h = setup();
    const binding = h.capture();
    const commit = deferred<object>();
    const create = deferred<object>();
    const first = h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      () => commit.promise,
    );
    const second = h.routes.backendRequestForCapturedBinding(
      h.hostWindow,
      binding,
      () => create.promise,
    );
    const createResult = { requestId: 'create', gitReceipts: [], existingPR: true };
    const commitResult = {
      requestId: 'commit',
      gitReceipts: [{ stage: 'commit', commitHash: 'B' }],
    };
    create.resolve(createResult);
    const createCompletion = await second;
    commit.resolve(commitResult);
    const commitCompletion = await first;
    expect(
      h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, createCompletion),
    ).toEqual({ status: 'fulfilled', value: createResult });
    expect(
      h.routes.readRetainedRepositoryOperation(h.hostWindow, binding, commitCompletion),
    ).toEqual({ status: 'fulfilled', value: commitResult });
  });
});

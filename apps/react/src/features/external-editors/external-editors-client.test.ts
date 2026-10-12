// Real React Store/principal selector/client/backend and canonical source-route mapper.
// Only declared backend preload delivery is controlled; no native scan/open or app root.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { store } from '../../store';
import {
  selectHostAdministrationContext,
  selectPrincipalConnectionContext,
} from '../../store/principal/principal-selectors';
import { externalEditorsClient } from './external-editors-client';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../src/store/renderer/slices/principal/principal-slice';
import { connectionStatusChanged } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';

type Outcome<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected'; error: unknown };
const cleanups: Array<() => Promise<void>> = [];
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      settled = true;
      resolvePromise(value);
    },
    reject(error: unknown) {
      settled = true;
      rejectPromise(error);
    },
  };
}
function value<T>(outcome: Outcome<T>): T {
  if (outcome.kind !== 'fulfilled') throw new Error('Expected a fulfilled editor read');
  return outcome.value;
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    vi.unstubAllGlobals();
  } catch (error) {
    errors.push(error);
  }
  try {
    vi.restoreAllMocks();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'External editor fixture cleanup failed');
});

function fixture(role: 'owner' | 'guest' | 'unadmitted' = 'owner') {
  const requests: Array<ReturnType<typeof deferred<unknown>>> = [];
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const observations: Array<Promise<Outcome<unknown>>> = [];
  const expectedErrors = new Set<unknown>();
  const runtimeErrors: unknown[] = [];
  const unexpectedCalls: unknown[] = [];
  let closing = false;
  let undoHandler: (() => void) | undefined;
  let errorObservation: { unsubscribe(): void } | undefined;
  let restoreGlobal: (() => void) | undefined;
  let storeAcquisitionAttempted = false;
  cleanups.push(cleanup);

  function observe<T>(promise: Promise<T>): Promise<Outcome<T>> {
    const observed = promise.then(
      (result): Outcome<T> => ({ kind: 'fulfilled', value: result }),
      (error): Outcome<T> => ({ kind: 'rejected', error }),
    );
    observations.push(observed);
    return observed;
  }
  function retain<T>(promise: Promise<T>): Promise<T> {
    observe(promise);
    return promise;
  }
  function unexpected(detail: unknown): never {
    unexpectedCalls.push(detail);
    throw new Error('Unexpected external editor preload operation');
  }
  undoHandler = overrideMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('method' in payload) ||
      payload.method !== 'host.listInstalledEditors'
    )
      return unexpected(payload);
    const reply = deferred<unknown>();
    requests.push(reply);
    const promise = retain(reply.promise);
    if (closing) reply.resolve({ ok: true, result: { editors: [] } });
    return promise;
  });
  const api: Window['electronAPI'] & {
    platform: string;
    arch: string;
    versions: { node: string; chrome: string; electron: string };
  } = {
    invoke: (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST) return unexpected({ channel, args });
      return retain(mockInvoke(channel, ...args));
    },
    send: (...args: unknown[]) => unexpected({ send: args }),
    on: (...args: unknown[]) => unexpected({ on: args }),
    off: (...args: unknown[]) => unexpected({ off: args }),
    offById: (...args: unknown[]) => unexpected({ offById: args }),
    removeAllListeners: (...args: unknown[]) => unexpected({ removeAllListeners: args }),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
  };
  restoreGlobal = () => vi.unstubAllGlobals();
  vi.stubGlobal('window', { electronAPI: api });
  errorObservation = store.traceStreams.runtimeError.observe((event: unknown) =>
    runtimeErrors.push(event),
  );
  storeAcquisitionAttempted = true;
  store.init(role === 'unadmitted' ? undefined : createAdmittedLegacyPrincipal({}, role));

  async function cleanup() {
    const errors: unknown[] = [];
    closing = true;
    let observed = 0;
    try {
      do {
        for (const reply of requests) {
          try {
            if (!reply.settled) reply.resolve({ ok: true, result: { editors: [] } });
          } catch (error) {
            errors.push(error);
          }
        }
        const batch = observations.slice(observed);
        observed = observations.length;
        // Each raw/API/client result is observed independently before resource restoration.
        const drains = await Promise.allSettled(
          batch.map(async (observation) => {
            try {
              const outcome = await observation;
              if (outcome.kind === 'rejected' && !expectedErrors.has(outcome.error))
                errors.push(outcome.error);
            } catch (error) {
              errors.push(error);
            }
          }),
        );
        for (const drain of drains) if (drain.status === 'rejected') errors.push(drain.reason);
      } while (observed < observations.length);
    } catch (error) {
      errors.push(error);
    } finally {
      if (storeAcquisitionAttempted) {
        try {
          store.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      errors.push(...runtimeErrors, ...unexpectedCalls);
      try {
        errorObservation?.unsubscribe();
      } catch (error) {
        errors.push(error);
      }
      try {
        undoHandler?.();
      } catch (error) {
        errors.push(error);
      }
      try {
        restoreGlobal?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Unaccounted external editor read errors');
  }
  return {
    invocations,
    requests,
    read(forceRefresh?: boolean) {
      return observe(externalEditorsClient.detectInstalled(forceRefresh));
    },
    expectError(error: unknown) {
      expectedErrors.add(error);
    },
    async nextRequest(index = 0) {
      await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
      return requests[index];
    },
    admitCurrent(nextRole: 'owner' | 'guest') {
      const context = selectPrincipalConnectionContext.select(store.state);
      const snapshot = createAdmittedLegacyPrincipal({}, nextRole).principal.snapshot;
      if (!context || !snapshot)
        throw new Error('Admission fixture needs an actual connected context');
      store.dispatch(principalContextChanged(context));
      store.dispatch(
        principalReceived(
          {
            context,
            invalidation: store.state.principal.invalidation,
            presentationVersion: store.state.principal.presentationVersion,
          },
          snapshot,
        ),
      );
    },
  };
}

describe('actual React external editor daemon-read binding', () => {
  it('reads only the daemon catalog and uses the canonical enrichment for Finder and known IDs', async () => {
    const f = fixture();
    expect(selectHostAdministrationContext.select(store.state)).not.toBeNull();
    expect(f.invocations).toEqual([]);
    const pending = f.read();
    const reply = await f.nextRequest();
    reply.resolve({
      ok: true,
      result: {
        editors: [
          { id: 'finder', installed: false, path: '/wrong/path' },
          { id: 'unknown-editor', installed: true },
          { id: 'vscode', installed: true, source: 'path', name: 'untrusted title' },
        ],
      },
    });
    const result = value(await pending);
    expect(
      result.map((editor) => ({
        id: editor.id,
        installed: editor.installed,
        handlerType: editor.handlerType,
      })),
    ).toEqual([
      { id: 'finder', installed: true, handlerType: 'finder' },
      { id: 'vscode', installed: true, handlerType: 'vscode' },
    ]);
    expect(result[0]).toMatchObject({ name: 'Finder', bundleId: 'com.apple.finder' });
    expect(result[1]).toMatchObject({ name: 'VS Code', bundleId: 'com.microsoft.VSCode' });
    expect(result[1]).not.toHaveProperty('source');
    expect(f.invocations).toEqual([
      {
        channel: IPC_CHANNELS.BACKEND.REQUEST,
        args: [{ method: 'host.listInstalledEditors', params: undefined }],
      },
    ]);
  });

  it.each(['guest', 'unadmitted'] as const)(
    'returns the source empty-success result for %s without a backend request',
    async (role) => {
      const f = fixture(role);
      expect(selectHostAdministrationContext.select(store.state)).toBeNull();
      expect(value(await f.read(true))).toEqual([]);
      expect(f.invocations).toEqual([]);
    },
  );

  it.each(['guest', 'new-connection'] as const)(
    'drops a held successful response after actual %s authority changes',
    async (change) => {
      const f = fixture();
      const initial = selectHostAdministrationContext.select(store.state);
      expect(initial).not.toBeNull();
      const pending = f.read();
      const reply = await f.nextRequest();
      if (change === 'guest') f.admitCurrent('guest');
      else {
        store.dispatch(connectionStatusChanged('disconnected'));
        store.dispatch(connectionStatusChanged('connected'));
        store.dispatch(daemonEventsSubscribed(store.state.workspaceEvents.subscriptionAttempt));
        f.admitCurrent('owner');
        expect(selectHostAdministrationContext.select(store.state)).not.toBeNull();
      }
      expect(selectHostAdministrationContext.select(store.state)).not.toBe(initial);
      reply.resolve({ ok: true, result: { editors: [{ id: 'vscode', installed: true }] } });
      expect(value(await pending)).toEqual([]);
      expect(f.invocations).toHaveLength(1);
    },
  );

  it('preserves the daemon error envelope through the public client', async () => {
    const f = fixture();
    const pending = f.read();
    const reply = await f.nextRequest();
    reply.resolve({ ok: false, error: { code: 'FORBIDDEN', message: 'Editor catalog denied' } });
    const outcome = await pending;
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('Expected daemon refusal');
    expect(outcome.error).toEqual(new Error('Editor catalog denied'));
    f.expectError(outcome.error);
  });

  it('preserves a held transport error even after administration is revoked', async () => {
    const f = fixture();
    const pending = f.read();
    const reply = await f.nextRequest();
    f.admitCurrent('guest');
    const transportError = new Error('Held delivery failed');
    f.expectError(transportError);
    reply.reject(transportError);
    const outcome = await pending;
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('Expected transport failure');
    expect(outcome.error).toEqual(new Error('Held delivery failed'));
    expect(outcome.error).not.toBe(transportError);
    f.expectError(outcome.error);
  });

  it('preserves the source empty fallback for a malformed daemon catalog', async () => {
    const f = fixture();
    const pending = f.read();
    (await f.nextRequest()).resolve({ ok: true, result: { editors: null } });
    expect(value(await pending)).toEqual([]);
  });

  it('retains mapping failure for a malformed row instead of silently dropping it', async () => {
    const f = fixture();
    const pending = f.read();
    (await f.nextRequest()).resolve({ ok: true, result: { editors: [null] } });
    const outcome = await pending;
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('Expected malformed-row failure');
    expect(outcome.error).toBeInstanceOf(Error);
    f.expectError(outcome.error);
  });

  it('ignores forceRefresh at the source route and does not adopt native caching or scan semantics', async () => {
    const f = fixture();
    const ordinary = f.read(false);
    (await f.nextRequest()).resolve({
      ok: true,
      result: { editors: [{ id: 'vscode', installed: true }] },
    });
    expect(value(await ordinary)[0].installed).toBe(true);
    const forced = f.read(true);
    (await f.nextRequest(1)).resolve({
      ok: true,
      result: { editors: [{ id: 'vscode', installed: false }] },
    });
    expect(value(await forced)[0].installed).toBe(false);
    expect(f.invocations).toEqual([
      {
        channel: IPC_CHANNELS.BACKEND.REQUEST,
        args: [{ method: 'host.listInstalledEditors', params: undefined }],
      },
      {
        channel: IPC_CHANNELS.BACKEND.REQUEST,
        args: [{ method: 'host.listInstalledEditors', params: undefined }],
      },
    ]);
  });
});

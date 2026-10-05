import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DesktopExecutor,
  type DesktopConnection,
  type DesktopNative,
  type DesktopOverlay,
  type DesktopStopReports,
} from './desktop-executor';
import { DesktopNativeAdapter } from './desktop-native';
import { desktopFailure, parseDesktopRequest } from './desktop-validation';
import type { DesktopAction } from '../../../shared/types/desktop';

const binding = {
  workspaceId: 'ws',
  agentId: 'agent',
  principalId: 'human',
  connectionEpoch: 'epoch',
};
const session = { ...binding, computerId: 'computer', sessionId: 'session' };
const display = {
  displayId: 'screen',
  width: 3840,
  height: 2160,
  originX: -3840,
  originY: 0,
  scaleFactor: 2,
};
const start = {
  operation: 'startControl',
  ...session,
  agentName: 'Worker',
  leaseMs: 15000,
  stopReportToken: 'a'.repeat(43),
};
const error = (code: string, execution?: string) => ({
  data: { code, ...(execution ? { execution } : {}) },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  let now = 100;
  const native: DesktopNative = {
    identity: vi.fn(async () => ({
      computerId: 'computer',
      computerName: 'Mac',
      platform: 'macos',
    })),
    acquire: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
    validateExclusion: vi.fn(async () => {}),
    layout: vi.fn(async () => [{ ...display }]),
    capture: vi.fn(async () => [{ ...display, data: 'png' }]),
    input: vi.fn(async (_a, _d, check) => {
      check(true);
    }),
  };
  const overlay: DesktopOverlay = {
    activate: vi.fn(async () => {}),
    deactivate: vi.fn(async () => {}),
    pulse: vi.fn(),
    excludedWindows: () => ['123'],
  };
  const reports: DesktopStopReports = {
    retain: vi.fn(async () => {}),
    queue: vi.fn(async () => {}),
  };
  const connection: DesktopConnection = {
    backendId: 'backend',
    saveAsset: vi.fn(async () => ({ assetId: 'asset', url: 'workspace-asset://ws/asset' })),
    revoke: vi.fn(async () => ({})),
  };
  const executor = new DesktopExecutor(native, overlay, reports, () => now);
  const handle = (p: unknown) => executor.handle(connection, p);
  const activate = async () => {
    await handle({ operation: 'prepare', ...binding });
    return handle(start);
  };
  let sequence = 0;
  const prepare = async (action: DesktopAction) => {
    const seq = ++sequence;
    const result = (await handle({
      operation: 'prepareCommand',
      ...session,
      commandId: `c${seq}`,
      sequence: seq,
      action,
    })) as { deadlineId: string };
    return {
      operation: 'execute',
      ...session,
      commandId: `c${seq}`,
      sequence: seq,
      deadlineId: result.deadlineId,
    };
  };
  return {
    executor,
    handle,
    activate,
    prepare,
    native,
    overlay,
    reports,
    connection,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe('desktop display selection', () => {
  it('lists metadata without capture and permits an empty display list', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.native.layout).mockResolvedValue([]);
    await expect(t.handle(await t.prepare({ kind: 'listDisplay' }))).resolves.toMatchObject({
      result: { layoutId: expect.any(String), displays: [] },
    });
    expect(t.native.capture).not.toHaveBeenCalled();
    expect(t.connection.saveAsset).not.toHaveBeenCalled();
    expect(t.overlay.pulse).not.toHaveBeenCalled();
    await expect(t.prepare({ kind: 'screenshot' })).rejects.toMatchObject(
      error('desktop-display-unavailable', 'not_started'),
    );
    await t.executor.invalidate('agent_end');
  });
  it('lists current metadata when topology changes after preparation', async () => {
    const t = setup();
    await t.activate();
    const ticket = await t.prepare({ kind: 'listDisplay' });
    const latest = [{ ...display, width: 2160, height: 3840 }];
    vi.mocked(t.native.layout).mockResolvedValue(latest);
    await expect(t.handle(ticket)).resolves.toMatchObject({ result: { displays: latest } });
    expect(t.native.capture).not.toHaveBeenCalled();
    await t.executor.invalidate('agent_end');
  });
  it('requires selection on multiple displays and captures only the selected display', async () => {
    const t = setup();
    const second = { ...display, displayId: 'second', originX: 0 };
    vi.mocked(t.native.layout).mockResolvedValue([display, second]);
    await t.activate();
    await expect(t.prepare({ kind: 'screenshot' })).rejects.toMatchObject(
      error('desktop-display-selection-required', 'not_started'),
    );
    await expect(t.prepare({ kind: 'screenshot', displayId: 'missing' })).rejects.toMatchObject(
      error('desktop-display-unavailable', 'not_started'),
    );
    expect(t.native.capture).not.toHaveBeenCalled();
    expect(t.connection.saveAsset).not.toHaveBeenCalled();
    expect(t.overlay.pulse).not.toHaveBeenCalled();
    vi.mocked(t.native.capture).mockResolvedValue([{ ...second, data: 'png' }]);
    const result = (await t.handle(
      await t.prepare({ kind: 'screenshot', displayId: 'second' }),
    )) as { result: { displays: unknown[] } };
    expect(result.result.displays).toHaveLength(1);
    expect(t.native.capture).toHaveBeenCalledWith(['123'], expect.any(AbortSignal), second, [
      display,
      second,
    ]);
    expect(t.connection.saveAsset).toHaveBeenCalledTimes(1);
    await t.executor.invalidate('agent_end');
  });
  it('uses list metadata for single-display pointers and rejects ambiguous pointers', async () => {
    const t = setup();
    await t.activate();
    const listed = (await t.handle(await t.prepare({ kind: 'listDisplay' }))) as {
      result: { layoutId: string };
    };
    for (const action of [
      { kind: 'click', x: 1, y: 2 },
      { kind: 'scroll', x: 1, y: 2, deltaX: 0, deltaY: 10 },
      { kind: 'drag', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
    ] as const)
      await t.handle(await t.prepare({ ...action, layoutId: listed.result.layoutId }));
    expect(t.native.input).toHaveBeenCalledTimes(3);
    const second = { ...display, displayId: 'second' };
    vi.mocked(t.native.layout).mockResolvedValue([display, second]);
    const next = (await t.handle(await t.prepare({ kind: 'listDisplay' }))) as {
      result: { layoutId: string };
    };
    await expect(
      t.prepare({ kind: 'click', x: 1, y: 2, layoutId: next.result.layoutId }),
    ).rejects.toMatchObject(error('desktop-display-selection-required'));
    await t.executor.invalidate('agent_end');
  });
  it('rejects topology changes between preparation and execution without capture or input', async () => {
    const t = setup();
    await t.activate();
    const ticket = await t.prepare({ kind: 'screenshot' });
    vi.mocked(t.native.layout).mockResolvedValue([{ ...display, scaleFactor: 1 }]);
    await expect(t.handle(ticket)).rejects.toMatchObject(
      error('desktop-stale-layout', 'not_started'),
    );
    expect(t.native.capture).not.toHaveBeenCalled();
    expect(t.native.input).not.toHaveBeenCalled();
    expect(t.overlay.pulse).not.toHaveBeenCalled();
    await t.executor.invalidate('agent_end');
  });
  it.each(['click', 'scroll', 'drag'] as const)(
    'rejects missing selection for multi-display %s without input',
    async (kind) => {
      const t = setup();
      await t.activate();
      vi.mocked(t.native.layout).mockResolvedValue([display, { ...display, displayId: 'second' }]);
      const listed = (await t.handle(await t.prepare({ kind: 'listDisplay' }))) as {
        result: { layoutId: string };
      };
      const action: DesktopAction =
        kind === 'drag'
          ? { kind, layoutId: listed.result.layoutId, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }
          : kind === 'scroll'
            ? { kind, layoutId: listed.result.layoutId, x: 0, y: 0, deltaX: 0, deltaY: 1 }
            : { kind, layoutId: listed.result.layoutId, x: 0, y: 0 };
      await expect(t.prepare(action)).rejects.toMatchObject(
        error('desktop-display-selection-required', 'not_started'),
      );
      await expect(t.prepare({ ...action, displayId: 'missing' })).rejects.toMatchObject(
        error('desktop-display-unavailable', 'not_started'),
      );
      expect(t.native.input).not.toHaveBeenCalled();
      expect(t.native.capture).not.toHaveBeenCalled();
      expect(t.connection.saveAsset).not.toHaveBeenCalled();
      expect(t.overlay.pulse).not.toHaveBeenCalled();
      await t.executor.invalidate('agent_end');
    },
  );
  it('rejects unexpected extra native images without publishing any asset', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.native.capture).mockResolvedValue([
      { ...display, data: 'png' },
      { ...display, displayId: 'foreign', data: 'private' },
    ]);
    await expect(t.handle(await t.prepare({ kind: 'screenshot' }))).rejects.toMatchObject(
      error('desktop-execution-failed'),
    );
    expect(t.connection.saveAsset).not.toHaveBeenCalled();
    expect(t.overlay.pulse).not.toHaveBeenCalled();
  });
  it('requires active authority for listing and rejects stale screenshot layout tokens', async () => {
    const t = setup();
    await expect(t.prepare({ kind: 'listDisplay' })).rejects.toMatchObject(
      error('desktop-not-active'),
    );
    await t.activate();
    const listed = (await t.handle(await t.prepare({ kind: 'listDisplay' }))) as {
      result: { layoutId: string };
    };
    vi.mocked(t.native.layout).mockResolvedValue([{ ...display, width: 2160, height: 3840 }]);
    await expect(
      t.prepare({
        kind: 'screenshot',
        displayId: display.displayId,
        layoutId: listed.result.layoutId,
      }),
    ).rejects.toMatchObject(error('desktop-stale-layout', 'not_started'));
    expect(t.native.capture).not.toHaveBeenCalled();
    await t.executor.invalidate('agent_end');
  });
  it('reserves preparation while topology is read and rejects late preparation after Stop', async () => {
    const t = setup();
    await t.activate();
    const wait = deferred<(typeof display)[]>();
    vi.mocked(t.native.layout).mockReturnValue(wait.promise);
    const pending = t.prepare({ kind: 'screenshot' });
    await expect(t.prepare({ kind: 'listDisplay' })).rejects.toMatchObject(error('desktop-busy'));
    await t.executor.stop('session');
    wait.resolve([display]);
    await expect(pending).rejects.toMatchObject(error('desktop-not-active'));
    expect(t.native.capture).not.toHaveBeenCalled();
  });
  it('rejects pointer hotplug between preparation and execution', async () => {
    const t = setup();
    await t.activate();
    const listed = (await t.handle(await t.prepare({ kind: 'listDisplay' }))) as {
      result: { layoutId: string };
    };
    const ticket = await t.prepare({ kind: 'click', layoutId: listed.result.layoutId, x: 0, y: 0 });
    vi.mocked(t.native.layout).mockResolvedValue([
      display,
      { ...display, displayId: 'new-screen' },
    ]);
    await expect(t.handle(ticket)).rejects.toMatchObject(
      error('desktop-stale-layout', 'not_started'),
    );
    expect(t.native.input).not.toHaveBeenCalled();
    await t.executor.invalidate('agent_end');
  });
  it('sends selected-only capture and topology guards through the shared native adapter', async () => {
    const request = vi.fn(async (op: string, _params?: Record<string, unknown>) =>
      op === 'capture' ? [{ ...display, data: 'png' }] : op === 'layout' ? [] : { ok: true },
    );
    const adapter = new DesktopNativeAdapter(request);
    const signal = new AbortController().signal;
    expect(await adapter.layout()).toEqual([]);
    await adapter.capture(['overlay'], signal, display, [display]);
    expect(request).toHaveBeenCalledWith('capture', {
      excludedWindows: ['overlay'],
      display,
      layout: [display],
    });
    await adapter.input(
      { kind: 'click', x: 0, y: 0, layoutId: 'layout' },
      display,
      () => {},
      signal,
      [display],
    );
    for (const [op, params] of request.mock.calls) {
      if (op === 'move' || op === 'button') expect(params).toMatchObject({ layout: [display] });
    }
    expect(request).toHaveBeenLastCalledWith('releaseInput');
  });
  it('withholds a capture if topology changes during native capture', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.native.capture).mockImplementation(async () => {
      vi.mocked(t.native.layout).mockResolvedValue([]);
      return [{ ...display, data: 'png' }];
    });
    await expect(t.handle(await t.prepare({ kind: 'screenshot' }))).rejects.toMatchObject(
      error('desktop-stale-layout'),
    );
    expect(t.connection.saveAsset).not.toHaveBeenCalled();
    expect(t.overlay.pulse).not.toHaveBeenCalled();
  });
});

describe('desktop executor authority and command tickets', () => {
  it('binds a consent claimant to its own preparation and connection epoch', async () => {
    const t = setup();
    const claimant = { ...t.connection };
    await t.handle({ operation: 'prepare', ...binding });
    expect(t.native.acquire).not.toHaveBeenCalled();
    expect(t.overlay.activate).not.toHaveBeenCalled();
    // A fallback client's preparation cannot authorize the client that won Allow.
    await expect(t.executor.handle(claimant, start)).rejects.toMatchObject(error('forbidden'));
    await t.executor.handle(claimant, {
      operation: 'prepare',
      ...binding,
      connectionEpoch: 'claimant-epoch',
    });
    await expect(t.executor.handle(claimant, start)).rejects.toMatchObject(error('forbidden'));
    await expect(
      t.executor.handle(claimant, { ...start, connectionEpoch: 'claimant-epoch' }),
    ).resolves.toMatchObject({ ready: true });
    await expect(
      t.handle({ operation: 'renew', ...session, leaseMs: 15000 }),
    ).rejects.toMatchObject(error('forbidden'));
    await t.executor.invalidate('agent_end');
  });
  it('keeps a successor blocked until cancelled native work has settled', async () => {
    const t = setup();
    await t.activate();
    const wait = deferred<void>();
    vi.mocked(t.native.input).mockReturnValue(wait.promise);
    const pending = t.handle(await t.prepare({ kind: 'type', text: 'x' }));
    await vi.waitFor(() => expect(t.native.input).toHaveBeenCalled());
    await t.executor.stop('session');
    await expect(t.handle({ ...start, sessionId: 'successor' })).rejects.toMatchObject(
      error('desktop-busy'),
    );
    wait.resolve();
    await expect(pending).rejects.toMatchObject(error('desktop-not-active'));
    await expect(t.handle({ ...start, sessionId: 'successor' })).resolves.toMatchObject({
      ready: true,
      sessionId: 'successor',
    });
    await t.executor.stop('session');
    await expect(
      t.handle({ operation: 'renew', ...session, sessionId: 'successor', leaseMs: 15000 }),
    ).resolves.toMatchObject({ renewed: true });
    await t.executor.invalidate('agent_end');
  });
  it('requires preparation and locally completed readiness, including overlay exclusion', async () => {
    const t = setup();
    await expect(t.handle(start)).rejects.toMatchObject(error('forbidden'));
    expect(t.native.acquire).not.toHaveBeenCalled();
    expect(await t.activate()).toEqual({
      ready: true,
      computerId: 'computer',
      sessionId: 'session',
    });
    expect(t.native.validateExclusion).toHaveBeenCalledWith(['123']);
    expect(t.reports.retain).toHaveBeenCalledWith(
      expect.objectContaining({ backendId: 'backend', stopReportToken: 'a'.repeat(43) }),
    );
    await t.executor.invalidate('agent_end');
  });
  it('admits only one activation across backend connections, including during readiness', async () => {
    const t = setup();
    const wait = deferred<void>();
    vi.mocked(t.native.acquire).mockReturnValue(wait.promise);
    await t.handle({ operation: 'prepare', ...binding });
    const active = t.handle(start);
    const other = { ...t.connection };
    await t.executor.handle(other, { operation: 'prepare', ...binding });
    await expect(t.executor.handle(other, { ...start, sessionId: 'second' })).rejects.toMatchObject(
      error('desktop-busy'),
    );
    wait.resolve();
    await active;
    await t.executor.invalidate('agent_end');
  });
  it('does not execute on preparation, consumes once, and rejects foreign authority', async () => {
    const t = setup();
    await t.activate();
    const command = await t.prepare({ kind: 'type', text: '秘密🙂' });
    expect(t.native.input).not.toHaveBeenCalled();
    await expect(t.handle({ ...command, principalId: 'other' })).rejects.toMatchObject(
      error('forbidden', 'not_started'),
    );
    await expect(t.handle(command)).resolves.toEqual({
      commandId: 'c1',
      sequence: 1,
      result: { ok: true },
    });
    await expect(t.handle(command)).rejects.toMatchObject(
      error('desktop-stale-command', 'not_started'),
    );
    expect(t.native.input).toHaveBeenCalledTimes(1);
    await t.executor.invalidate('agent_end');
  });
  it('expires at exact original deadline despite renewal; never retries consumed tickets', async () => {
    const t = setup();
    await t.activate();
    const command = await t.prepare({ kind: 'type', text: 'x' });
    t.advance(9000);
    await t.handle({ operation: 'renew', ...session, leaseMs: 15000 });
    t.advance(1000);
    await expect(t.handle(command)).rejects.toMatchObject(
      error('desktop-command-expired', 'not_started'),
    );
    await expect(t.handle(command)).rejects.toMatchObject(
      error('desktop-command-expired', 'not_started'),
    );
    const newer = await t.prepare({ kind: 'type', text: 'new' });
    await expect(t.handle(command)).rejects.toMatchObject(
      error('desktop-command-expired', 'not_started'),
    );
    await t.handle(newer);
    expect(t.native.input).toHaveBeenCalledTimes(1);
    await t.executor.invalidate('agent_end');
  });
  it('rejects duplicate preparation without extending its lifetime', async () => {
    const t = setup();
    await t.activate();
    await t.prepare({ kind: 'screenshot' });
    await expect(
      t.handle({
        operation: 'prepareCommand',
        ...session,
        sequence: 1,
        commandId: 'c1',
        action: { kind: 'screenshot' },
      }),
    ).rejects.toMatchObject(error('desktop-stale-command'));
    await expect(t.prepare({ kind: 'screenshot' })).rejects.toMatchObject(error('desktop-busy'));
    await t.executor.invalidate('agent_end');
  });
  it('invalidates immediately on disconnect and requires fresh preparation after reconnect', async () => {
    const t = setup();
    await t.activate();
    const command = await t.prepare({ kind: 'type', text: 'x' });
    t.executor.disconnect(t.connection);
    await expect(t.handle(command)).rejects.toMatchObject(error('desktop-not-active'));
    await expect(t.handle(start)).rejects.toMatchObject(error('forbidden'));
    expect(t.native.input).not.toHaveBeenCalled();
    expect(t.native.release).toHaveBeenCalled();
  });
  it('rejects a preparation response that races connection replacement', async () => {
    const t = setup();
    const wait = deferred<{ computerId: string; computerName: string; platform: 'macos' }>();
    vi.mocked(t.native.identity).mockReturnValue(wait.promise);
    const pending = t.handle({ operation: 'prepare', ...binding });
    t.executor.disconnect(t.connection);
    wait.resolve({ computerId: 'computer', computerName: 'Mac', platform: 'macos' });
    await expect(pending).rejects.toMatchObject(error('desktop-offline'));
    await expect(t.handle(start)).rejects.toMatchObject(error('forbidden'));
  });
  it('ends authority immediately when OS permissions disappear during renewal', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.native.check).mockRejectedValue(new Error('permission lost'));
    await expect(t.handle({ operation: 'renew', ...session, leaseMs: 15000 })).rejects.toThrow();
    await expect(t.prepare({ kind: 'type', text: 'x' })).rejects.toMatchObject(
      error('desktop-not-active'),
    );
  });
  it('fails closed on clock regression and an expired lease', async () => {
    for (const delta of [-1, 15000]) {
      const t = setup();
      await t.activate();
      const command = await t.prepare({ kind: 'screenshot' });
      t.advance(delta);
      await expect(t.handle(command)).rejects.toMatchObject(
        error(delta < 0 ? 'desktop-deadline-unavailable' : 'desktop-not-active'),
      );
      expect(t.native.capture).not.toHaveBeenCalled();
    }
  });
  it('withholds capture results and pulse when Stop races asset persistence', async () => {
    const t = setup();
    await t.activate();
    const wait = deferred<{ assetId: string; url: string }>();
    vi.mocked(t.connection.saveAsset).mockReturnValue(wait.promise);
    const command = await t.prepare({ kind: 'screenshot' });
    const result = t.handle(command);
    await vi.waitFor(() => expect(t.connection.saveAsset).toHaveBeenCalled());
    await t.executor.stop('session');
    wait.resolve({ assetId: 'asset', url: 'workspace-asset://ws/asset' });
    await expect(result).rejects.toMatchObject(error('desktop-not-active', 'partial'));
    expect(t.overlay.pulse).not.toHaveBeenCalled();
    expect(t.reports.queue).toHaveBeenCalledTimes(1);
  });
  it('rejects failed or noncanonical assets and never pulses on failure', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.connection.saveAsset).mockResolvedValue({
      assetId: 'asset',
      url: '/tmp/private.png',
    });
    await expect(t.handle(await t.prepare({ kind: 'screenshot' }))).rejects.toMatchObject(
      error('desktop-execution-failed'),
    );
    expect(t.overlay.pulse).not.toHaveBeenCalled();
  });
  it('maps right double clicks only against a current captured display and rejects changed layout', async () => {
    const t = setup();
    await t.activate();
    const capture = (await t.handle(await t.prepare({ kind: 'screenshot' }))) as {
      result: { layoutId: string };
    };
    const action: DesktopAction = {
      kind: 'click',
      displayId: 'screen',
      layoutId: capture.result.layoutId,
      x: 3839,
      y: 2159,
      button: 'right',
      clickCount: 2,
    };
    await t.handle(await t.prepare(action));
    expect(t.native.input).toHaveBeenCalledWith(
      action,
      display,
      expect.any(Function),
      expect.any(AbortSignal),
      [display],
    );
    vi.mocked(t.native.layout).mockResolvedValue([{ ...display, scaleFactor: 1 }]);
    await expect(t.prepare(action)).rejects.toMatchObject(
      error('desktop-stale-layout', 'not_started'),
    );
    await t.executor.invalidate('agent_end');
  });
  it('local Stop succeeds at invalidation even if its notification cannot be persisted', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.reports.queue).mockRejectedValue(new Error('disk full'));
    const command = await t.prepare({ kind: 'type', text: 'x' });
    await expect(t.executor.stop('session')).rejects.toThrow('disk full');
    await expect(t.handle(command)).rejects.toMatchObject(error('desktop-not-active'));
    expect(t.native.release).toHaveBeenCalled();
    expect(t.overlay.deactivate).toHaveBeenCalledWith('session');
  });
  it('returns partial if a command expires between native steps', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.native.input).mockImplementation(async (_a, _d, check) => {
      check(true);
      t.advance(10000);
      check();
    });
    await expect(
      t.handle(await t.prepare({ kind: 'keypress', key: 'Enter' })),
    ).rejects.toMatchObject(error('desktop-command-expired', 'partial'));
    expect(t.native.release).toHaveBeenCalled();
  });
});

describe('desktop startup failure authority', () => {
  it('waits for cleanup, preserves the structured start error and fences late callbacks from a successor', async () => {
    const t = setup();
    const release = deferred<void>();
    const entered = deferred<void>();
    const failure = desktopFailure(
      'desktop-execution-failed',
      'Overlay readiness refused',
      'not_started',
    );
    let invalidate!: Parameters<DesktopOverlay['activate']>[2];
    vi.mocked(t.native.release).mockImplementationOnce(() => release.promise);
    vi.mocked(t.overlay.activate).mockImplementationOnce(async (_session, _stop, ended) => {
      invalidate = ended;
      ended('executor_failed');
      entered.resolve();
      throw failure;
    });
    let settled = false;
    const pending = t.activate().catch((error) => {
      settled = true;
      return error;
    });
    await entered.promise;
    expect(vi.mocked(t.native.acquire).mock.calls[0][0].aborted).toBe(true);
    await expect(t.handle({ ...start, sessionId: 'successor' })).rejects.toMatchObject(
      error('desktop-busy'),
    );
    expect(settled).toBe(false);
    expect(t.connection.revoke).not.toHaveBeenCalled();
    release.resolve();
    expect(await pending).toBe(failure);
    expect(t.connection.revoke).not.toHaveBeenCalled();
    // If the error reply is lost, neither a renewal nor the daemon's later
    // endControl cleanup can revive this locally released session.
    await expect(
      t.handle({ operation: 'renew', ...session, leaseMs: 15000 }),
    ).rejects.toMatchObject(error('desktop-not-active'));
    await expect(t.handle({ operation: 'endControl', ...session })).resolves.toMatchObject({
      ended: false,
    });
    await expect(t.handle({ ...start, sessionId: 'successor' })).resolves.toMatchObject({
      ready: true,
    });
    invalidate('executor_failed');
    await expect(
      t.handle({ operation: 'renew', ...session, sessionId: 'successor', leaseMs: 15000 }),
    ).resolves.toMatchObject({ renewed: true });
    expect(t.native.release).toHaveBeenCalledOnce();
    await t.executor.invalidate('agent_end', false);
  });

  it('continues reporting executor failures after activation', async () => {
    const t = setup();
    await t.activate();
    vi.mocked(t.overlay.activate).mock.calls[0][2]('executor_failed');
    await t.executor.invalidate('executor_failed');
    expect(t.connection.revoke).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'ws',
      sessionId: 'session',
      reason: 'executor_failed',
    });
    expect(t.reports.queue).not.toHaveBeenCalled();
    await expect(
      t.handle({ operation: 'renew', ...session, leaseMs: 15000 }),
    ).rejects.toMatchObject(error('desktop-not-active'));
  });

  it.each(['user_stop', 'screen_locked', 'lease_expired', 'disconnected'] as const)(
    'preserves %s during readiness and refuses late readiness completion',
    async (reason) => {
      const t = setup();
      const entered = deferred<void>();
      const ready = deferred<void>();
      let stop!: () => void;
      let invalidate!: Parameters<DesktopOverlay['activate']>[2];
      vi.mocked(t.overlay.activate).mockImplementationOnce(async (_session, stopped, ended) => {
        stop = stopped;
        invalidate = ended;
        entered.resolve();
        await ready.promise;
      });
      const pending = t.activate().catch((error) => error);
      await entered.promise;
      if (reason === 'user_stop') stop();
      else if (reason === 'disconnected') t.executor.disconnect(t.connection);
      else if (reason === 'lease_expired') {
        t.advance(15000);
        await expect(
          t.handle({ operation: 'renew', ...session, leaseMs: 15000 }),
        ).rejects.toMatchObject(error('desktop-not-active'));
      } else invalidate(reason);
      await t.executor.invalidate(reason, false);
      expect(vi.mocked(t.native.acquire).mock.calls[0][0].aborted).toBe(true);
      ready.resolve();
      expect(await pending).toMatchObject(error('desktop-not-active'));
      expect(t.native.validateExclusion).not.toHaveBeenCalled();
      expect(t.native.input).not.toHaveBeenCalled();
      if (reason === 'user_stop') {
        expect(t.reports.queue).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ sessionId: 'session' }),
        );
        expect(t.connection.revoke).not.toHaveBeenCalled();
      } else if (reason === 'disconnected') {
        expect(t.reports.queue).not.toHaveBeenCalled();
        expect(t.connection.revoke).not.toHaveBeenCalled();
      } else {
        expect(t.connection.revoke).toHaveBeenCalledExactlyOnceWith({
          workspaceId: 'ws',
          sessionId: 'session',
          reason,
        });
        expect(t.reports.queue).not.toHaveBeenCalled();
      }
    },
  );
});

describe('strict desktop validation', () => {
  it.each([
    { kind: 'type', text: 'é'.repeat(8193) },
    { kind: 'type', text: '\uD800' },
    { kind: 'keypress', key: 'Enter', modifiers: ['Meta', 'Meta'] },
    { kind: 'keypress', key: 'F25' },
    { kind: 'click', displayId: 'screen', layoutId: 'layout', x: Infinity, y: 0 },
    { kind: 'click', displayId: 'screen', layoutId: 'layout', x: 0, y: 0, button: 'middle' },
    { kind: 'type', text: 'x', command: 'rm -rf /' },
    { kind: 'screenshot', clientId: 'foreign' },
  ])('refuses malformed actions without accepting extra authority (case %#)', (action) => {
    expect(() =>
      parseDesktopRequest({
        operation: 'prepareCommand',
        ...session,
        commandId: 'c',
        sequence: 1,
        action,
      }),
    ).toThrow();
  });
});

describe('native adapter observable step behavior', () => {
  it('reports partial execution when a later native step is refused', async () => {
    const request = vi.fn(async (op: string) => {
      if (op === 'button')
        throw desktopFailure('desktop-os-permission-required', 'Elevated target', 'not_started');
      return {};
    });
    await expect(
      new DesktopNativeAdapter(request).input(
        { kind: 'click', displayId: 'screen', layoutId: 'layout', x: 12, y: 24 },
        display,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject(error('desktop-os-permission-required', 'partial'));
    expect(request.mock.calls.map((c) => c[0])).toEqual(['move', 'button', 'releaseInput']);
  });
  it('emits a right double click at display-local image coordinates', async () => {
    const request = vi.fn(async () => ({}));
    const adapter = new DesktopNativeAdapter(request);
    await adapter.input(
      {
        kind: 'click',
        displayId: 'screen',
        layoutId: 'layout',
        x: 12,
        y: 24,
        button: 'right',
        clickCount: 2,
      },
      display,
      () => {},
      new AbortController().signal,
    );
    expect(request.mock.calls).toEqual([
      ['move', { display, x: 12, y: 24 }],
      ['button', { button: 'right', down: true, clickCount: 1 }],
      ['button', { button: 'right', down: false, clickCount: 1 }],
      ['button', { button: 'right', down: true, clickCount: 2 }],
      ['button', { button: 'right', down: false, clickCount: 2 }],
      ['releaseInput'],
    ]);
  });
  it('releases held keys and executes no continuation after cancellation', async () => {
    const abort = new AbortController();
    const request = vi.fn(async (op: string) => {
      if (op === 'key') abort.abort();
      return {};
    });
    await expect(
      new DesktopNativeAdapter(request).input(
        { kind: 'keypress', key: 'Enter', modifiers: ['Meta'] },
        undefined,
        () => {},
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(request.mock.calls.map((c) => c[0])).toEqual(['validateKey', 'key', 'releaseInput']);
  });
  it('types exact Unicode scalars without clipboard mutation or implicit enter', async () => {
    const request = vi.fn(async () => ({}));
    await new DesktopNativeAdapter(request).input(
      { kind: 'type', text: 'A🙂\n' },
      undefined,
      () => {},
      new AbortController().signal,
    );
    expect(request.mock.calls).toEqual([
      ['text', { text: 'A' }],
      ['text', { text: '🙂' }],
      ['text', { text: '\n' }],
      ['releaseInput'],
    ]);
  });
  it('does not emit drag continuation after revocation and still releases input', async () => {
    const abort = new AbortController();
    let moves = 0;
    const request = vi.fn(async (op: string) => {
      if (op === 'move' && ++moves === 2) abort.abort();
      return {};
    });
    await expect(
      new DesktopNativeAdapter(request).input(
        {
          kind: 'drag',
          displayId: 'screen',
          layoutId: 'layout',
          from: { x: 0, y: 0 },
          to: { x: 200, y: 100 },
        },
        display,
        () => {},
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(request.mock.calls.map((c) => c[0])).toEqual(['move', 'button', 'move', 'releaseInput']);
  });
});

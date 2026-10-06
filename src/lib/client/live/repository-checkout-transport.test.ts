import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createRepositoryCheckoutTransport } from './repository-checkout-transport';

const channels = IPC_CHANNELS.BACKEND.REPOSITORY_CHECKOUT;
const capture = {
  checkoutId: 'lease-A',
  revision: 'account-A',
  provider: 'gitlab',
  instanceBaseUrl: 'https://forge.example:8443/Forge',
  expiresAfterMs: 600000,
};
const selection = {
  checkoutId: capture.checkoutId,
  revision: capture.revision,
  projectPath: 'nested/team/project',
  branch: 'release/next',
  commitSha: 'a'.repeat(40),
  mode: 'cached' as const,
};
const envelope = (value: unknown) => ({ ok: true, result: value });
const ready = (value: unknown) => ({ status: 'ready', value });
function harness() {
  let retired: (value: unknown) => void = () => {};
  const bridge = {
    invoke: vi.fn(async (_channel: string, _params: unknown): Promise<unknown> =>
      envelope(ready({ id: 'local-A', capture })),
    ),
    on: vi.fn((_channel: string, listener: (value: unknown) => void) => {
      retired = listener;
      return 'listener-A';
    }),
    offById: vi.fn(),
  };
  let current = bridge;
  const open = createRepositoryCheckoutTransport(() => current as unknown as Window['electronAPI']);
  return {
    bridge,
    open,
    retire: (value: unknown) => retired(value),
    replace: () => {
      current = { ...bridge, invoke: vi.fn() };
      return current;
    },
  };
}
async function acquire(h: ReturnType<typeof harness>) {
  const result = await h.open({ provider: 'gitlab', instanceBaseUrl: capture.instanceBaseUrl });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected admitted capture');
  return result.value;
}

describe('checkout facade through the captured preload bridge', () => {
  it('registers retirement before capture and keeps full-root input without an invented workspace', async () => {
    const h = harness();
    const session = await acquire(h);
    expect(h.bridge.on.mock.invocationCallOrder[0]).toBeLessThan(
      h.bridge.invoke.mock.invocationCallOrder[0],
    );
    expect(h.bridge.invoke).toHaveBeenCalledExactlyOnceWith(channels.CAPTURE, {
      provider: 'gitlab',
      instanceBaseUrl: capture.instanceBaseUrl,
    });
    h.bridge.invoke.mockResolvedValue(
      envelope(ready({ items: [], nextCursor: 'opaque', cached: true })),
    );
    expect(
      await session.branches({
        projectPath: selection.projectPath,
        query: 'release/',
        cursor: 'original-page',
        limit: 50,
        cached: true,
      }),
    ).toMatchObject({ status: 'ready', value: { nextCursor: 'opaque' } });
    expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.REQUEST, {
      id: 'local-A',
      kind: 'branches',
      params: {
        projectPath: selection.projectPath,
        query: 'release/',
        cursor: 'original-page',
        limit: 50,
        cached: true,
      },
    });
    await session.release();
    await session.release();
    expect(h.bridge.invoke.mock.calls.filter(([channel]) => channel === channels.RELEASE)).toEqual([
      [channels.RELEASE, { id: 'local-A' }],
    ]);
    expect(h.bridge.offById).toHaveBeenCalledExactlyOnceWith(channels.RETIRED, 'listener-A');
  });
  it.each(['disabled', 'not-connected', 'access-denied'] as const)(
    'preserves typed %s capture refusal and removes its listener',
    async (reason) => {
      const h = harness();
      h.bridge.invoke.mockResolvedValue(envelope({ status: 'unavailable', reason }));
      expect(await h.open({ provider: 'gitlab' })).toEqual({ status: 'unavailable', reason });
      expect(h.bridge.invoke).toHaveBeenCalledOnce();
      expect(h.bridge.offById).toHaveBeenCalledOnce();
    },
  );
  it('releases a known allocated id when another capture field is malformed', async () => {
    const h = harness();
    h.bridge.invoke.mockResolvedValueOnce(
      envelope(ready({ id: 'local-A', capture: { ...capture, provider: 'github' } })),
    );
    await expect(h.open({ provider: 'gitlab' })).rejects.toThrow();
    expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'local-A' });
    expect(h.bridge.offById).toHaveBeenCalledOnce();
  });
  it('rejects a lease retired before its capture reply arrives', async () => {
    const h = harness();
    const held = Promise.withResolvers<unknown>();
    h.bridge.invoke.mockReturnValueOnce(held.promise);
    const opening = h.open({ provider: 'gitlab' });
    h.retire({ id: 'local-A' });
    held.resolve(envelope(ready({ id: 'local-A', capture })));
    await expect(opening).rejects.toThrow('REPOSITORY_CHECKOUT_UNAVAILABLE');
    expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'local-A' });
  });
  it('ignores a different lease retirement but suppresses original late private rows', async () => {
    const h = harness();
    const s = await acquire(h);
    const onRetired = vi.fn();
    s.onRetired(onRetired);
    h.retire({ id: 'other-local' });
    expect(onRetired).not.toHaveBeenCalled();
    const held = Promise.withResolvers<unknown>();
    h.bridge.invoke.mockReturnValueOnce(held.promise);
    const pending = s.projects({});
    h.retire({ id: 'local-A' });
    held.resolve(envelope(ready({ items: [] })));
    expect(await pending).toEqual({ status: 'unavailable', reason: 'retired' });
    expect(onRetired).toHaveBeenCalledOnce();
    await s.release();
  });
  it('never dispatches to a replacement preload bridge', async () => {
    const h = harness();
    const s = await acquire(h);
    const next = h.replace();
    expect(await s.projects({})).toEqual({ status: 'unavailable', reason: 'retired' });
    await s.release();
    expect(next.invoke).not.toHaveBeenCalled();
    expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'local-A' });
  });
  it.each(['projectPath', 'branch', 'commitSha'] as const)(
    'refuses a warm result with a different %s',
    async (field) => {
      const h = harness();
      const s = await acquire(h);
      h.bridge.invoke.mockResolvedValueOnce(
        envelope(
          ready({
            projectPath: selection.projectPath,
            branch: selection.branch,
            commitSha: selection.commitSha,
            cached: true,
            [field]: field === 'commitSha' ? 'b'.repeat(40) : 'other/value',
          }),
        ),
      );
      await expect(s.warm(selection)).rejects.toThrow();
      expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.RELEASE, { id: 'local-A' });
    },
  );
  it('refuses a foreign revision without dispatch and preserves matching warm operands', async () => {
    const h = harness();
    const s = await acquire(h);
    expect(await s.warm({ ...selection, revision: 'account-B' })).toEqual({
      status: 'unavailable',
      reason: 'retired',
    });
    expect(h.bridge.invoke).toHaveBeenCalledOnce();
    const value = {
      projectPath: selection.projectPath,
      branch: selection.branch,
      commitSha: selection.commitSha,
      cached: true,
    };
    h.bridge.invoke.mockResolvedValueOnce(envelope(ready(value)));
    expect(await s.warm(selection)).toEqual(ready(value));
    expect(h.bridge.invoke).toHaveBeenLastCalledWith(channels.REQUEST, {
      id: 'local-A',
      kind: 'warm',
      params: selection,
    });
    await s.release();
  });
});

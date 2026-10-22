import { describe, expect, it, vi } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
import { RepositoryResourceTargetSchema } from '$shared/types/repository-resource-read';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createRepositoryResourceTransport } from './repository-resource-transport';
const channels = IPC_CHANNELS.BACKEND.REPOSITORY_RESOURCE;
function harness() {
  let listener: (raw: unknown) => void = () => {};
  const bridge = {
    on: vi.fn((_channel: string, fn: (value: unknown) => void) => {
      listener = fn;
      return 'listener';
    }),
    offById: vi.fn(),
    invoke: vi.fn(async (channel: string) => ({
      ok: true,
      result:
        channel === channels.CAPTURE
          ? { id: 'main-id', capture: fixture.capture }
          : channel === channels.DETAIL
            ? fixture.issue
            : { released: true },
    })),
  };
  let current: Window['electronAPI'] | undefined = bridge as unknown as Window['electronAPI'];
  return {
    bridge,
    capture: createRepositoryResourceTransport(() => current),
    notice: (raw: unknown) => listener(raw),
    replace: () => {
      current = { ...bridge } as unknown as Window['electronAPI'];
    },
  };
}
describe('original renderer resource bridge', () => {
  it('decodes the detail path and releases exactly once on the original bridge', async () => {
    const h = harness();
    const session = await h.capture('workspace-A');
    await expect(
      session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target)),
    ).resolves.toEqual(fixture.issue);
    await session.release();
    await session.release();
    expect(h.bridge.invoke.mock.calls.filter(([c]) => c === channels.RELEASE)).toHaveLength(1);
    expect(h.bridge.offById).toHaveBeenCalledTimes(1);
  });
  it('honors retirement that arrived before capture reply', async () => {
    const h = harness();
    h.bridge.invoke.mockImplementationOnce(async () => {
      h.notice({ id: 'main-id' });
      return { ok: true, result: { id: 'main-id', capture: fixture.capture } };
    });
    await expect(h.capture('workspace-A')).rejects.toBeDefined();
    expect(h.bridge.invoke.mock.calls.some(([c]) => c === channels.DETAIL)).toBe(false);
  });
  it.each(['success', 'error'])(
    'never applies a late %s to a replacement bridge',
    async (outcome) => {
      const h = harness();
      const session = await h.capture('workspace-A');
      let finish!: (value: unknown) => void, reject!: (reason: unknown) => void;
      h.bridge.invoke.mockImplementationOnce(
        () =>
          new Promise((resolve, no) => {
            finish = resolve;
            reject = no;
          }) as never,
      );
      const read = session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
      const asserted = expect(read).rejects.toBeDefined();
      h.replace();
      if (outcome === 'success') finish({ ok: true, result: fixture.issue });
      else reject(new Error('private transport prose'));
      await asserted;
      expect(h.bridge.invoke.mock.calls.at(-1)?.[0]).toBe(channels.RELEASE);
    },
  );
  it('does not fall back when the bridge is absent', async () => {
    await expect(
      createRepositoryResourceTransport(() => undefined)('workspace-A'),
    ).rejects.toBeDefined();
  });
});

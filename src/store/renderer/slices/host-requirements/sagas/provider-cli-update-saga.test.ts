import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import { providerCliUpdateRequested } from '../host-requirements-slice';
import { providerCliRequirementsSaga } from './provider-cli-requirements-saga';

function harness() {
  const channel = stdChannel();
  const dispatch = vi.fn((action) => channel.put(action));
  const task = runSaga({ channel, dispatch, getState: () => ({}) }, providerCliRequirementsSaga);
  const opened = () =>
    dispatch.mock.calls.map(([action]) => action).filter((a) => a.type === 'terminals/open');
  return { channel, dispatch, task, opened };
}

describe('provider CLI update launch', () => {
  it('runs `codex update` interactively in a root terminal and opens the drawer', async () => {
    mocks.invoke.mockReset().mockResolvedValue({ ok: true, terminalId: 'codex-update' });
    const { channel, task, opened } = harness();
    try {
      const request = providerCliUpdateRequested('codex');
      channel.put(request);
      await request.promise;
      expect(mocks.invoke.mock.calls).toEqual([
        [
          'terminal:createWithCommand',
          { workspaceId: '__root__', command: 'codex update', interactive: true },
        ],
      ]);
      expect(opened()).toEqual([{ type: 'terminals/open', payload: ['__root__', 'codex-update'] }]);
    } finally {
      task.cancel();
      await task.toPromise();
    }
  });

  it.each(['claude-code', 'pi', 'constructor', '__proto__'])(
    'never executes a command for a provider without an allowlisted update (%s)',
    async (providerId) => {
      mocks.invoke.mockReset().mockResolvedValue({ ok: true, terminalId: 'unexpected' });
      const { channel, task, opened } = harness();
      try {
        const request = providerCliUpdateRequested(providerId);
        channel.put(request);
        await expect(request.promise).rejects.toThrow();
        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(opened()).toEqual([]);
      } finally {
        task.cancel();
        await task.toPromise();
      }
    },
  );

  it('surfaces the terminal error envelope and allows a retry', async () => {
    mocks.invoke
      .mockReset()
      .mockResolvedValueOnce({ ok: false, error: 'spawn failed' })
      .mockResolvedValueOnce({ ok: true, terminalId: 'retry' });
    const { channel, task, opened } = harness();
    try {
      const first = providerCliUpdateRequested('codex');
      channel.put(first);
      await expect(first.promise).rejects.toThrow('spawn failed');
      expect(opened()).toEqual([]);
      const retry = providerCliUpdateRequested('codex');
      channel.put(retry);
      await retry.promise;
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      expect(opened()).toHaveLength(1);
    } finally {
      task.cancel();
      await task.toPromise();
    }
  });

  it.each(['success', 'failure', 'rejection', 'cancellation'])(
    'coalesces repeat clicks into one terminal and settles every caller on %s',
    async (outcome) => {
      let resolveLaunch!: (value: unknown) => void;
      let rejectLaunch!: (error: Error) => void;
      mocks.invoke.mockReset().mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveLaunch = resolve;
            rejectLaunch = reject;
          }),
      );
      const { channel, task, opened } = harness();
      const first = providerCliUpdateRequested('codex');
      const second = providerCliUpdateRequested('codex');
      const settled = Promise.allSettled([first.promise, second.promise]);
      try {
        channel.put(first);
        channel.put(second);
        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        if (outcome === 'cancellation') task.cancel();
        else if (outcome === 'rejection') rejectLaunch(new Error('spawn failed'));
        else
          resolveLaunch(
            outcome === 'success'
              ? { ok: true, terminalId: 'shared-update' }
              : { ok: false, error: 'spawn failed' },
          );
        const results = await settled;
        expect(results.map((result) => result.status)).toEqual(
          outcome === 'success' ? ['fulfilled', 'fulfilled'] : ['rejected', 'rejected'],
        );
        expect(opened()).toHaveLength(outcome === 'success' ? 1 : 0);
      } finally {
        task.cancel();
        await task.toPromise();
      }
    },
  );
});

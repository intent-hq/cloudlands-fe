import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { SshSetupRunnerDeps } from '../ssh-setup-runner';

const runner = {
  start: vi.fn(),
  trust: vi.fn(),
  cancel: vi.fn(),
  activeRunId: vi.fn(() => null),
};
let runnerDeps: SshSetupRunnerDeps | null = null;
vi.mock('../ssh-setup-runner', () => ({
  createSshSetupRunner: (deps: SshSetupRunnerDeps) => {
    runnerDeps = deps;
    return runner;
  },
}));

const pairInspect = vi.fn();
const pairDiscard = vi.fn();
vi.mock('../../../backend/main/pair-link.ipc', () => ({
  getPairLinks: () => ({ inspect: pairInspect, discard: pairDiscard }),
}));
const inviteInspect = vi.fn();
const inviteDiscard = vi.fn();
vi.mock('../../../backend/main/remote-machines.ipc', () => ({
  getNodeInvites: () => ({ inspect: inviteInspect, discard: inviteDiscard }),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const CHANNELS = IPC_CHANNELS.MACHINE_SETUP;
type Handler = (event: { sender: FakeSender }, params: unknown) => unknown;

class FakeSender extends EventEmitter {
  sent: unknown[][] = [];
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
  }
  send(...args: unknown[]) {
    this.sent.push(args);
  }
}

let registered: Record<string, Handler> | null = null;
async function handlers(): Promise<Record<string, Handler>> {
  if (registered) return registered;
  const mod = await import('../ssh-setup.ipc');
  mod.registerSshSetupHandlers();
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as [string, Handler][];
  registered = Object.fromEntries(calls.map(([channel, handler]) => [channel, handler]));
  return registered;
}

const valid = {
  host: ' box ',
  port: 22,
  username: 'dev',
  auth: { method: 'password', password: 'SECRET-PW' },
  target: 'backend',
};

beforeEach(() => {
  vi.clearAllMocks();
  runner.activeRunId.mockReturnValue(null);
});

describe('parseStartParams', () => {
  it('accepts each auth method and trims the host', async () => {
    const { parseStartParams } = await import('../ssh-setup.ipc');
    expect(parseStartParams(valid)).toEqual({ ...valid, host: 'box' });
    expect(parseStartParams({ ...valid, auth: { method: 'agent' } })?.auth).toEqual({
      method: 'agent',
    });
    expect(
      parseStartParams({ ...valid, auth: { method: 'key', keyPath: '~/.ssh/id', passphrase: '' } })
        ?.auth,
    ).toEqual({ method: 'key', keyPath: '~/.ssh/id' });
  });

  it.each([
    null,
    { ...valid, port: 0 },
    { ...valid, port: 22.5 },
    { ...valid, host: '-oProxyCommand=x' },
    { ...valid, host: 'a b' },
    { ...valid, username: '' },
    { ...valid, target: 'other' },
    { ...valid, auth: { method: 'password', password: '' } },
    { ...valid, auth: { method: 'key', keyPath: '' } },
    { ...valid, auth: { method: 'key', keyPath: '~/k', passphrase: 5 } },
    { ...valid, auth: { method: 'magic' } },
  ])('rejects %o', async (value) => {
    const { parseStartParams } = await import('../ssh-setup.ipc');
    expect(parseStartParams(value)).toBeNull();
  });
});

describe('ssh setup IPC', () => {
  it('rejects a bad payload without echoing it', async () => {
    const h = await handlers();
    const sender = new FakeSender();
    let message = '';
    try {
      h[CHANNELS.SSH_START]({ sender }, { ...valid, port: -1 });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('Invalid');
    expect(message).not.toContain('SECRET-PW');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('sends events only to the starting window and cancels when it closes', async () => {
    const h = await handlers();
    const sender = new FakeSender();
    const other = new FakeSender();
    runner.start.mockReturnValue({ ok: true, runId: 'run-1' });
    expect(h[CHANNELS.SSH_START]({ sender }, valid)).toEqual({ ok: true, runId: 'run-1' });
    expect(runner.start).toHaveBeenCalledWith({ ...valid, host: 'box' });

    runnerDeps!.emit({ runId: 'run-1', type: 'step', step: 'connecting' });
    expect(sender.sent).toEqual([
      [CHANNELS.SSH_EVENT, { runId: 'run-1', type: 'step', step: 'connecting' }],
    ]);
    expect(other.sent).toEqual([]);

    expect(h[CHANNELS.SSH_TRUST]({ sender: other }, { runId: 'run-1', trusted: true })).toEqual({
      ok: false,
    });
    expect(h[CHANNELS.SSH_CANCEL]({ sender: other }, { runId: 'run-1' })).toEqual({ ok: false });
    runner.trust.mockReturnValue(true);
    expect(h[CHANNELS.SSH_TRUST]({ sender }, { runId: 'run-1', trusted: true })).toEqual({
      ok: true,
    });
    expect(runner.trust).toHaveBeenCalledWith('run-1', true);

    sender.emit('destroyed');
    expect(runner.cancel).toHaveBeenCalledWith('run-1');
    runnerDeps!.emit({ runId: 'run-1', type: 'step', step: 'installing' });
    expect(sender.sent).toHaveLength(1);
  });

  it('forgets the window after the run ends', async () => {
    const h = await handlers();
    const sender = new FakeSender();
    runner.start.mockReturnValue({ ok: true, runId: 'run-2' });
    h[CHANNELS.SSH_START]({ sender }, valid);
    runnerDeps!.emit({ runId: 'run-2', type: 'failed', code: 'no-link', step: 'pairing' });
    expect(sender.listenerCount('destroyed')).toBe(0);
    sender.emit('destroyed');
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it('passes busy through', async () => {
    const h = await handlers();
    runner.start.mockReturnValue({ ok: false, code: 'busy' });
    expect(h[CHANNELS.SSH_START]({ sender: new FakeSender() }, valid)).toEqual({
      ok: false,
      code: 'busy',
    });
  });
});

describe('holdSetupLink', () => {
  it('holds a pair link with the uname label', async () => {
    const { holdSetupLink } = await import('../ssh-setup.ipc');
    pairInspect.mockResolvedValue({
      ok: true,
      pendingId: 'p1',
      kind: 'node',
      label: 'build-box',
      existingId: 'conn-9',
    });
    expect(await holdSetupLink('intent://pair?x', 'build-box')).toEqual({
      kind: 'pair',
      pendingId: 'p1',
      machineKind: 'node',
      label: 'build-box',
      existingId: 'conn-9',
    });
    expect(pairInspect).toHaveBeenCalledWith('intent://pair?x', { label: 'build-box' });
    pairInspect.mockResolvedValue({ ok: false, code: 'rejected' });
    expect(await holdSetupLink('intent://pair?x', 'build-box')).toBeNull();
  });

  it('holds a node link in the node-invite pipeline', async () => {
    const { holdSetupLink } = await import('../ssh-setup.ipc');
    inviteInspect.mockReturnValue({ ok: true, pendingId: 'n1', label: '10.0.0.5' });
    expect(await holdSetupLink('intent://node?v=1', 'build-box')).toEqual({
      kind: 'invite',
      pendingId: 'n1',
      label: 'build-box',
    });
    expect(pairInspect).not.toHaveBeenCalled();
    inviteInspect.mockReturnValue({ ok: false, code: 'incomplete' });
    expect(await holdSetupLink('intent://node?v=1', 'build-box')).toBeNull();
  });
});

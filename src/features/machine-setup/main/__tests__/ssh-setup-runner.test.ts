import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { utils, type ConnectConfig } from 'ssh2';
import type { SshSetupEvent, SshSetupLink, SshSetupStartParams } from '$shared/types/machine-setup';
import {
  createSshSetupRunner,
  installCommand,
  SSH_SETUP_TIMEOUTS,
  sshErrorCode,
  type SshChannelLike,
  type SshClientError,
  type SshClientLike,
  type SshSetupRunnerDeps,
} from '../ssh-setup-runner';
import { sha256Fingerprint } from '../known-hosts';
import {
  chunked,
  installerOutput,
  NODE_SECRET,
  NODE_URI,
  PAIR_NODE_OUTPUT,
  PAIR_OUTPUT,
  PAIR_TOKEN,
  PAIR_URI,
} from './fixtures';

const PASSWORD = 'hunter2-PASSWORD-xyz';
const PASSPHRASE = 'correct-horse-PASSPHRASE';

const hostPair = utils.generateKeyPairSync('ed25519');
const hostParsed = utils.parseKey(hostPair.public);
if (hostParsed instanceof Error) throw hostParsed;
const HOST_KEY = hostParsed.getPublicSSH();
const otherParsed = utils.parseKey(utils.generateKeyPairSync('ed25519').public);
if (otherParsed instanceof Error) throw otherParsed;
const OTHER_KEY = otherParsed.getPublicSSH();
const KNOWN = `box ssh-ed25519 ${HOST_KEY.toString('base64')}\n`;

/** What the fake server answers for one exec. `hang` never closes. */
type Reply = { stdout?: string; stderr?: string; code?: number | null; chunk?: number } | 'hang';

interface FakeOptions {
  /** Fail the connection with this error instead of signing in. */
  connectError?: SshClientError;
  hostKey?: Buffer;
  exec(command: string): Reply;
}

class FakeChannel extends EventEmitter {
  stderr = new EventEmitter();
}

class FakeClient extends EventEmitter {
  config: ConnectConfig | null = null;
  ended = false;
  commands: string[] = [];
  channels: FakeChannel[] = [];

  constructor(private readonly options: FakeOptions) {
    super();
  }

  connect(config: ConnectConfig) {
    this.config = config;
    queueMicrotask(() => {
      if (this.ended) return;
      if (this.options.connectError) {
        this.emit('error', this.options.connectError);
        return;
      }
      const verifier = config.hostVerifier as (key: Buffer, verify: (ok: boolean) => void) => void;
      verifier(this.options.hostKey ?? HOST_KEY, (ok) => {
        if (this.ended) return;
        if (!ok) {
          const error: SshClientError = new Error('Host denied (verification failed)');
          error.level = 'client-ssh';
          this.emit('error', error);
          this.emit('close');
          return;
        }
        this.emit('ready');
      });
    });
    return this;
  }

  exec(
    command: string,
    _options: unknown,
    callback: (error: Error | undefined, channel: SshChannelLike) => void,
  ) {
    this.commands.push(command);
    const channel = new FakeChannel();
    this.channels.push(channel);
    const reply = this.options.exec(command);
    callback(undefined, channel);
    if (reply === 'hang') return this;
    queueMicrotask(() => {
      if (this.ended) return;
      for (const chunk of chunked(reply.stdout ?? '', reply.chunk ?? 7))
        channel.emit('data', chunk);
      for (const chunk of chunked(reply.stderr ?? '', 5)) channel.stderr.emit('data', chunk);
      channel.emit('close', reply.code === undefined ? 0 : reply.code);
    });
    return this;
  }

  end() {
    this.ended = true;
    return this;
  }
}

interface Script {
  os?: string;
  install?: Reply;
  pair?: Reply;
  linger?: string[];
  sudoEnables?: boolean;
}

function server(script: Script = {}): (command: string) => Reply {
  const lingerStates = [...(script.linger ?? ['Linger=yes'])];
  let enabled = false;
  return (command) => {
    if (command.startsWith('uname -s'))
      return { stdout: `${script.os ?? 'Linux'}\nbuild-box\ndev\n` };
    if (command.includes('install.sh'))
      return script.install ?? { stdout: installerOutput(PAIR_URI) };
    if (command.includes('command -v intentd')) return script.pair ?? { stdout: PAIR_OUTPUT };
    if (command.includes('enable-linger')) {
      enabled = script.sudoEnables === true;
      return { code: enabled ? 0 : 1, stderr: 'sudo: a password is required\n' };
    }
    if (command.includes('show-user')) {
      const state = enabled ? 'Linger=yes' : (lingerStates.shift() ?? 'Linger=no');
      return { stdout: `${state}\n` };
    }
    return { code: 127 };
  };
}

const PAIR_LINK: SshSetupLink = {
  kind: 'pair',
  pendingId: 'pending-1',
  machineKind: 'machine',
  label: 'build-box',
  existingId: null,
};

function harness(
  options: Partial<FakeOptions> & { script?: Script; deps?: Partial<SshSetupRunnerDeps> } = {},
) {
  const events: SshSetupEvent[] = [];
  const clients: FakeClient[] = [];
  const files: Record<string, string> = {
    '/home/me/.ssh/known_hosts': KNOWN,
    '/home/me/.ssh/id_ed25519': 'PRIVATE KEY',
  };
  const holdLink = vi.fn<SshSetupRunnerDeps['holdLink']>(async () => PAIR_LINK);
  const discardLink = vi.fn<NonNullable<SshSetupRunnerDeps['discardLink']>>();
  const parseKey = vi.fn<SshSetupRunnerDeps['parseKey']>(
    (_data, passphrase) => passphrase === undefined || passphrase === PASSPHRASE,
  );
  const runner = createSshSetupRunner({
    createClient: (): SshClientLike => {
      const client = new FakeClient({ exec: server(options.script), ...options });
      clients.push(client);
      return client;
    },
    readFile: async (path) => {
      if (!(path in files)) throw new Error('ENOENT');
      return Buffer.from(files[path]);
    },
    homeDir: '/home/me',
    env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
    platform: 'linux',
    parseKey,
    holdLink,
    discardLink,
    emit: (event) => events.push(event),
    newRunId: () => 'run-1',
    ...options.deps,
  });
  const terminal = () => events.find((e) => e.type === 'done' || e.type === 'failed');
  const settle = async () => {
    for (let i = 0; i < 200 && !terminal(); i++) await new Promise((r) => setImmediate(r));
    return terminal();
  };
  return { runner, events, clients, holdLink, discardLink, parseKey, settle, files };
}

const params = (overrides: Partial<SshSetupStartParams> = {}): SshSetupStartParams => ({
  host: 'box',
  port: 22,
  username: 'dev',
  auth: { method: 'password', password: PASSWORD },
  target: 'backend',
  ...overrides,
});

const steps = (events: SshSetupEvent[]) =>
  events.flatMap((event) => (event.type === 'step' ? [event.step] : []));
const logLines = (events: SshSetupEvent[]) =>
  events.flatMap((event) => (event.type === 'log' ? event.lines : []));

function expectNoSecretsEmitted(events: SshSetupEvent[]) {
  const json = JSON.stringify(events);
  for (const secret of [PASSWORD, PASSPHRASE, PAIR_TOKEN, NODE_SECRET, 'intent://', 'INTENT_LINK'])
    expect(json).not.toContain(secret);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ssh setup runner: success', () => {
  it('installs, captures the marker link and holds it', async () => {
    const h = harness();
    expect(h.runner.start(params())).toEqual({ ok: true, runId: 'run-1' });
    const end = await h.settle();
    expect(end).toEqual({
      runId: 'run-1',
      type: 'done',
      result: { link: PAIR_LINK, lingerUser: null, macBackgroundOnly: false },
    });
    expect(steps(h.events)).toEqual(['connecting', 'installing', 'starting', 'pairing', 'adding']);
    expect(h.holdLink).toHaveBeenCalledWith(PAIR_URI, 'build-box');
    expect(h.clients[0].commands).toContain(installCommand('backend'));
    expect(h.clients[0].commands.some((c) => c.includes('command -v intentd'))).toBe(false);
    expect(logLines(h.events)).toContain(
      'install.sh: waiting for the daemon to respond (first start downloads the daemon binary)...',
    );
    expect(h.clients[0].ended).toBe(true);
    expect(h.runner.activeRunId()).toBeNull();
    expectNoSecretsEmitted(h.events);
  });

  it('runs the installer without a PTY with the env inline', async () => {
    const h = harness({
      script: { install: { stdout: installerOutput(NODE_URI, { node: true }) } },
    });
    h.runner.start(params({ target: 'node' }));
    await h.settle();
    const install = h.clients[0].commands.find((c) => c.includes('install.sh'));
    expect(install).toBe(
      '(curl -fsSL https://github.com/intent-hq/intentd-releases/releases/download/sitter-latest/install.sh' +
        ' || wget -qO- https://github.com/intent-hq/intentd-releases/releases/download/sitter-latest/install.sh)' +
        ' | INTENTD_INSTALL_SERVICE=1 INTENTD_PAIR=1 INTENTD_LINK_MARKER=1 INTENTD_DAEMON_MODE=node sh',
    );
    expect(h.holdLink).toHaveBeenCalledWith(NODE_URI, 'build-box');
    expect(steps(h.events)).toContain('pairing');
    expectNoSecretsEmitted(h.events);
  });

  it('falls back to `intentd pair` when an older installer prints no marker', async () => {
    const h = harness({ script: { install: { stdout: installerOutput(null) } } });
    h.runner.start(params());
    expect((await h.settle())?.type).toBe('done');
    const pair = h.clients[0].commands.find((c) => c.includes('command -v intentd'));
    expect(pair).toContain('/usr/local/bin/intentd');
    expect(pair).toContain('$HOME/.local/bin/intentd');
    expect(pair).toContain('pair --yes --tunnel');
    expect(h.holdLink).toHaveBeenCalledWith(PAIR_URI, 'build-box');
    expectNoSecretsEmitted(h.events);
  });

  it('falls back to `intentd pair --node` for a node', async () => {
    const h = harness({
      script: {
        install: { stdout: installerOutput(null, { node: true }) },
        pair: { stdout: PAIR_NODE_OUTPUT },
      },
    });
    h.runner.start(params({ target: 'node' }));
    expect((await h.settle())?.type).toBe('done');
    const pair = h.clients[0].commands.find((c) => c.includes('command -v intentd'));
    expect(pair).toContain('pair --node --tunnel --yes');
    expect(h.holdLink).toHaveBeenCalledWith(NODE_URI, 'build-box');
    expectNoSecretsEmitted(h.events);
  });

  it('uses a URL line an older installer printed instead of pairing again', async () => {
    const h = harness({
      script: { install: { stdout: installerOutput(null, { withPairOutput: true }) } },
    });
    h.runner.start(params());
    expect((await h.settle())?.type).toBe('done');
    expect(h.clients[0].commands.some((c) => c.includes('command -v intentd'))).toBe(false);
    expect(h.holdLink).toHaveBeenCalledWith(PAIR_URI, 'build-box');
    expectNoSecretsEmitted(h.events);
  });
});

describe('ssh setup runner: start', () => {
  it('emits nothing until the next tick after start returns', async () => {
    const deferred: (() => void)[] = [];
    const h = harness({ deps: { defer: (callback) => void deferred.push(callback) } });
    expect(h.runner.start(params())).toEqual({ ok: true, runId: 'run-1' });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(h.events).toEqual([]);
    expect(h.clients).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    deferred[0]();
    expect((await h.settle())?.type).toBe('done');
    expect(h.events[0]).toEqual({ runId: 'run-1', type: 'step', step: 'connecting' });
  });

  it('defaults to setImmediate', async () => {
    const h = harness();
    h.runner.start(params());
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(h.events).toEqual([]);
    await new Promise((r) => setImmediate(r));
    expect(h.events[0]).toEqual({ runId: 'run-1', type: 'step', step: 'connecting' });
  });

  it('a run cancelled before its first tick emits nothing', async () => {
    const h = harness();
    h.runner.start(params());
    h.runner.cancel('run-1');
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.events).toEqual([]);
    expect(h.clients).toHaveLength(0);
  });
});

describe('ssh setup runner: failures', () => {
  it('refuses an unsupported OS', async () => {
    const h = harness({ script: { os: 'FreeBSD' } });
    h.runner.start(params());
    expect(await h.settle()).toEqual({
      runId: 'run-1',
      type: 'failed',
      code: 'unsupported-os',
      step: 'connecting',
      os: 'FreeBSD',
    });
    expect(h.clients[0].commands.some((c) => c.includes('install.sh'))).toBe(false);
  });

  it('reports a failed installer', async () => {
    const h = harness({ script: { install: { stdout: 'install.sh: error: no curl\n', code: 1 } } });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({
      type: 'failed',
      code: 'install-failed',
      step: 'installing',
    });
    expect(h.holdLink).not.toHaveBeenCalled();
  });

  it('reports a failed fallback pair as install-failed', async () => {
    const h = harness({
      script: { install: { stdout: installerOutput(null) }, pair: { stdout: '', code: 127 } },
    });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({
      type: 'failed',
      code: 'install-failed',
      step: 'pairing',
    });
  });

  it('reports no link when the fallback prints none', async () => {
    const h = harness({
      script: { install: { stdout: installerOutput(null) }, pair: { stdout: 'error: nope\n' } },
    });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({ type: 'failed', code: 'no-link', step: 'pairing' });
  });

  it('reports a rejected link (null or a throw)', async () => {
    for (const hold of [async () => null, async () => Promise.reject(new Error('x'))]) {
      const h = harness({ deps: { holdLink: vi.fn(hold) } });
      h.runner.start(params());
      expect(await h.settle()).toMatchObject({
        type: 'failed',
        code: 'link-rejected',
        step: 'adding',
      });
    }
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'unreachable'],
    [{ code: 'ENOTFOUND' }, 'unreachable'],
    [{ code: 'EHOSTUNREACH' }, 'unreachable'],
    [{ code: 'ETIMEDOUT' }, 'unreachable'],
    [{ level: 'client-timeout' }, 'unreachable'],
    [{ level: 'client-authentication' }, 'auth-refused'],
    [{ level: 'protocol' }, 'failed'],
  ] as const)('maps the ssh2 error %o to %s', async (fields, code) => {
    const error: SshClientError = Object.assign(new Error('boom'), fields);
    expect(sshErrorCode(error)).toBe(code);
    const h = harness({ connectError: error });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({ type: 'failed', code, step: 'connecting' });
    expectNoSecretsEmitted(h.events);
  });

  it('needs an agent for agent sign-in', async () => {
    const h = harness({ deps: { env: {} } });
    h.runner.start(params({ auth: { method: 'agent' } }));
    expect(await h.settle()).toMatchObject({ type: 'failed', code: 'no-agent' });
    expect(h.clients).toHaveLength(0);
  });

  it('signs in with the agent socket, or pageant on Windows', async () => {
    const h = harness();
    h.runner.start(params({ auth: { method: 'agent' } }));
    await h.settle();
    expect(h.clients[0].config?.agent).toBe('/tmp/agent.sock');

    const w = harness({ deps: { env: {}, platform: 'win32' } });
    w.runner.start(params({ auth: { method: 'agent' } }));
    expect((await w.settle())?.type).toBe('done');
    expect(w.clients[0].config?.agent).toBe('pageant');
  });

  it('reads the key file with ~ expanded and the passphrase', async () => {
    const h = harness();
    h.runner.start(
      params({ auth: { method: 'key', keyPath: '~/.ssh/id_ed25519', passphrase: PASSPHRASE } }),
    );
    expect((await h.settle())?.type).toBe('done');
    expect(h.clients[0].config?.privateKey?.toString()).toBe('PRIVATE KEY');
    expect(h.clients[0].config?.passphrase).toBe(PASSPHRASE);
    expectNoSecretsEmitted(h.events);
  });

  it('reports an unreadable key file or a wrong passphrase', async () => {
    const missing = harness();
    missing.runner.start(params({ auth: { method: 'key', keyPath: '~/.ssh/nope' } }));
    expect(await missing.settle()).toMatchObject({ type: 'failed', code: 'key-unreadable' });

    const wrong = harness();
    wrong.runner.start(
      params({ auth: { method: 'key', keyPath: '~/.ssh/id_ed25519', passphrase: 'wrong' } }),
    );
    expect(await wrong.settle()).toMatchObject({ type: 'failed', code: 'key-unreadable' });
    expect(wrong.clients).toHaveLength(0);
  });

  it('answers keyboard-interactive prompts with the password', async () => {
    const h = harness();
    h.runner.start(params());
    await h.settle();
    const answers: string[][] = [];
    h.clients[0].emit(
      'keyboard-interactive',
      '',
      '',
      '',
      [{ prompt: 'Password:' }],
      (a: string[]) => answers.push(a),
    );
    expect(answers).toEqual([[PASSWORD]]);
  });
});

describe('ssh setup runner: host keys', () => {
  it('asks about an unknown key and continues when trusted', async () => {
    const h = harness();
    h.files['/home/me/.ssh/known_hosts'] = '';
    h.runner.start(params());
    for (let i = 0; i < 20 && !h.events.some((e) => e.type === 'host-key'); i++)
      await new Promise((r) => setImmediate(r));
    expect(h.events.find((e) => e.type === 'host-key')).toEqual({
      runId: 'run-1',
      type: 'host-key',
      fingerprint: sha256Fingerprint(HOST_KEY),
      algorithm: 'ssh-ed25519',
    });
    expect(h.runner.trust('other-run', true)).toBe(false);
    expect(h.runner.trust('run-1', true)).toBe(true);
    expect((await h.settle())?.type).toBe('done');
  });

  it('stops when the user declines an unknown key', async () => {
    const h = harness();
    h.files['/home/me/.ssh/known_hosts'] = '';
    h.runner.start(params());
    for (let i = 0; i < 20 && !h.events.some((e) => e.type === 'host-key'); i++)
      await new Promise((r) => setImmediate(r));
    h.runner.trust('run-1', false);
    expect(await h.settle()).toMatchObject({
      type: 'failed',
      code: 'host-key-declined',
      step: 'connecting',
    });
  });

  it('refuses a key that differs from known_hosts', async () => {
    const h = harness({ hostKey: OTHER_KEY });
    h.runner.start(params());
    expect(await h.settle()).toEqual({
      runId: 'run-1',
      type: 'failed',
      code: 'host-key-mismatch',
      step: 'connecting',
      fingerprint: sha256Fingerprint(OTHER_KEY),
    });
    expect(h.events.some((e) => e.type === 'host-key')).toBe(false);
  });

  it('does not count the user deciding against the connect timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    h.files['/home/me/.ssh/known_hosts'] = '';
    h.runner.start(params());
    await vi.advanceTimersByTimeAsync(10);
    expect(h.events.some((e) => e.type === 'host-key')).toBe(true);
    await vi.advanceTimersByTimeAsync(SSH_SETUP_TIMEOUTS.connectMs * 3);
    expect(h.events.some((e) => e.type === 'failed')).toBe(false);
    h.runner.trust('run-1', true);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.events.at(-1)?.type).toBe('done');
  });
});

describe('ssh setup runner: timeouts and cancel', () => {
  it('gives up after 2 minutes of installer silence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ script: { install: 'hang' } });
    h.runner.start(params());
    await vi.advanceTimersByTimeAsync(10);
    expect(steps(h.events)).toContain('installing');
    await vi.advanceTimersByTimeAsync(SSH_SETUP_TIMEOUTS.installSilenceMs - 1_000);
    expect(h.events.some((e) => e.type === 'failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.events.at(-1)).toMatchObject({ type: 'failed', code: 'no-link', step: 'installing' });
    expect(h.clients[0].ended).toBe(true);
    expect(h.runner.activeRunId()).toBeNull();
  });

  it('gives pairing 3 minutes of silence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ script: { install: 'hang' } });
    h.runner.start(params());
    await vi.advanceTimersByTimeAsync(10);
    const channel = h.clients[0].channels.at(-1)!;
    channel.emit('data', Buffer.from('install.sh: pairing — the link below adds this computer\n'));
    await vi.advanceTimersByTimeAsync(SSH_SETUP_TIMEOUTS.installSilenceMs + 30_000);
    expect(h.events.some((e) => e.type === 'failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(SSH_SETUP_TIMEOUTS.pairingSilenceMs);
    expect(h.events.at(-1)).toMatchObject({ type: 'failed', code: 'no-link', step: 'pairing' });
  });

  it('gives up after 10 minutes overall even with output', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ script: { install: 'hang' } });
    h.runner.start(params());
    await vi.advanceTimersByTimeAsync(10);
    const channel = h.clients[0].channels.at(-1)!;
    for (let minute = 0; minute < 11 && !h.events.some((e) => e.type === 'failed'); minute++) {
      channel.emit('data', Buffer.from('install.sh: still working\n'));
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(h.events.at(-1)).toMatchObject({ type: 'failed', code: 'no-link' });
  });

  it('batches log lines', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ script: { install: 'hang' } });
    h.runner.start(params());
    await vi.advanceTimersByTimeAsync(10);
    const channel = h.clients[0].channels.at(-1)!;
    channel.emit('data', Buffer.from('one\ntwo\nthr'));
    channel.emit('data', Buffer.from('ee\n'));
    expect(h.events.some((e) => e.type === 'log')).toBe(false);
    await vi.advanceTimersByTimeAsync(SSH_SETUP_TIMEOUTS.logBatchMs);
    expect(h.events.filter((e) => e.type === 'log')).toEqual([
      { runId: 'run-1', type: 'log', lines: ['one', 'two', 'three'] },
    ]);
  });

  it('cancel closes the client at once and emits nothing after', async () => {
    const h = harness({ script: { install: 'hang' } });
    h.runner.start(params());
    for (let i = 0; i < 50 && !steps(h.events).includes('installing'); i++)
      await new Promise((r) => setImmediate(r));
    const before = h.events.length;
    expect(h.runner.cancel('other')).toBe(false);
    expect(h.runner.cancel('run-1')).toBe(true);
    expect(h.clients[0].ended).toBe(true);
    expect(h.runner.activeRunId()).toBeNull();
    const channel = h.clients[0].channels.at(-1)!;
    channel.emit('data', Buffer.from(`${installerOutput(PAIR_URI)}`));
    channel.emit('close', 0);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.events.length).toBe(before);
    expect(h.holdLink).not.toHaveBeenCalled();
  });

  it('cancel during the host-key question emits nothing', async () => {
    const h = harness();
    h.files['/home/me/.ssh/known_hosts'] = '';
    h.runner.start(params());
    for (let i = 0; i < 20 && !h.events.some((e) => e.type === 'host-key'); i++)
      await new Promise((r) => setImmediate(r));
    const before = h.events.length;
    h.runner.cancel('run-1');
    expect(h.runner.trust('run-1', true)).toBe(false);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.events.length).toBe(before);
  });

  it('discards a link held after the run was cancelled', async () => {
    let release: (link: SshSetupLink) => void = () => {};
    const holdLink = vi.fn(
      () =>
        new Promise<SshSetupLink>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness({ deps: { holdLink } });
    h.runner.start(params());
    for (let i = 0; i < 50 && !holdLink.mock.calls.length; i++)
      await new Promise((r) => setImmediate(r));
    const before = h.events.length;
    h.runner.cancel('run-1');
    release(PAIR_LINK);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.discardLink).toHaveBeenCalledWith(PAIR_LINK);
    expect(h.events.length).toBe(before);
  });

  it('runs one setup at a time', async () => {
    const h = harness({ script: { install: 'hang' } });
    expect(h.runner.start(params()).ok).toBe(true);
    expect(h.runner.start(params())).toEqual({ ok: false, code: 'busy' });
    h.runner.cancel('run-1');
    expect(h.runner.start(params()).ok).toBe(true);
  });
});

describe('ssh setup runner: after install', () => {
  it('reports lingering still off', async () => {
    const h = harness({ script: { linger: ['Linger=no', 'Linger=no'] } });
    h.runner.start(params());
    const end = await h.settle();
    expect(end).toMatchObject({ type: 'done', result: { lingerUser: 'dev' } });
    expect(h.clients[0].commands).toContain('sudo -n loginctl enable-linger "$(id -un)"');
  });

  it('does not touch sudo when lingering is on', async () => {
    const h = harness({ script: { linger: ['Linger=yes'] } });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({ type: 'done', result: { lingerUser: null } });
    expect(h.clients[0].commands.some((c) => c.includes('enable-linger'))).toBe(false);
  });

  it('turns lingering on with passwordless sudo', async () => {
    const h = harness({ script: { linger: ['Linger=no'], sudoEnables: true } });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({ type: 'done', result: { lingerUser: null } });
    expect(h.clients[0].commands.some((c) => c.includes('enable-linger'))).toBe(true);
  });

  it('flags a macOS background-domain install', async () => {
    const h = harness({
      script: { os: 'Darwin', install: { stdout: installerOutput(PAIR_URI, { mac: true }) } },
    });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({
      type: 'done',
      result: { macBackgroundOnly: true, lingerUser: null },
    });
    expect(h.clients[0].commands.some((c) => c.includes('loginctl'))).toBe(false);
  });

  it('does not flag a macOS desktop install', async () => {
    const h = harness({ script: { os: 'Darwin' } });
    h.runner.start(params());
    expect(await h.settle()).toMatchObject({ type: 'done', result: { macBackgroundOnly: false } });
  });
});

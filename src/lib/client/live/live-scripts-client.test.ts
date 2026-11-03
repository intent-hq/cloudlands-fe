/**
 * Wire-contract tests for the live scripts domain (PROTOCOL §5.8).
 *
 * Regression: the scripts panel was fed by the mock client, so daemon-managed
 * scripts never reached the store and every mutation hit an unbridged Electron
 * IPC channel. Asserts (a) the exact JSON-RPC requests the client emits for
 * `script.list/create/remove/start/stop/restart/output/status/run` and (b)
 * PROTOCOL-shaped responses pass through verbatim.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { LiveScriptsClient, SCRIPT_GET_MAX_PARTS } from './live-scripts-client';
import type { ScriptWithState } from '$store/renderer/slices/scripts/scripts-types';

const mockedRequest = vi.mocked(backendRequest);

/** §5.8 `script.list` entry: camelCase definition + merged `runtime` block. */
const DEV_SCRIPT: ScriptWithState = {
  id: 's-1',
  workspaceId: 'ws-1',
  name: 'dev',
  command: 'pnpm dev',
  cwd: 'app',
  env: { PORT: '3000' },
  mode: 'service',
  category: 'dev',
  source: 'user',
  autoStart: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  runtime: { status: 'running', pid: 4242, restartCount: 0, detectedUrl: 'http://localhost:3000' },
};

describe('LiveScriptsClient (fake transport)', () => {
  beforeEach(() => {
    vi.spyOn(LiveScriptsClient.prototype, 'supportsLifecycle').mockResolvedValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('list forwards script.list with workspaceId and returns scripts verbatim', async () => {
    mockedRequest
      .mockResolvedValueOnce({
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: { scriptActiveLists: 1 },
        },
      })
      .mockResolvedValueOnce({ scripts: [DEV_SCRIPT] });
    const client = new LiveScriptsClient();

    const scripts = await client.list('ws-1');

    expect(mockedRequest).toHaveBeenCalledWith('script.list', {
      workspaceId: 'ws-1',
      archive: 'active',
    });
    expect(scripts).toEqual([DEV_SCRIPT]);
  });

  it('list passes runtime.previouslyRunning through verbatim (§5.8)', async () => {
    const previouslyRunning: ScriptWithState = {
      ...DEV_SCRIPT,
      runtime: { status: 'idle', restartCount: 0, previouslyRunning: true },
    };
    mockedRequest
      .mockResolvedValueOnce({
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: { scriptActiveLists: 1 },
        },
      })
      .mockResolvedValueOnce({ scripts: [previouslyRunning] });
    const client = new LiveScriptsClient();

    const scripts = await client.list('ws-1');

    expect(mockedRequest).toHaveBeenCalledWith('script.list', {
      workspaceId: 'ws-1',
      archive: 'active',
    });
    expect(scripts).toEqual([previouslyRunning]);
    expect(scripts[0].runtime.previouslyRunning).toBe(true);
  });

  it('list surfaces malformed results and transport failures', async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce({});
    await expect(client.list('ws-1')).rejects.toThrow();
    mockedRequest.mockRejectedValueOnce(new Error('uds boom'));
    await expect(client.list('ws-1')).rejects.toThrow();
  });

  it('list reads every full-view page when the host pages full lists (boundedReads)', async () => {
    const second: ScriptWithState = { ...DEV_SCRIPT, id: 's-2', name: 'test' };
    const hello = {
      server: {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        capabilities: { scriptActiveLists: 1, boundedReads: 1 },
      },
    };
    mockedRequest
      .mockResolvedValueOnce(hello)
      .mockResolvedValueOnce({ scripts: [DEV_SCRIPT], nextCursor: 'c-1' })
      .mockResolvedValueOnce({ scripts: [second] });
    const scripts = await new LiveScriptsClient().list('ws-1');

    expect(scripts).toEqual([DEV_SCRIPT, second]);
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'script.list', {
      workspaceId: 'ws-1',
      archive: 'active',
      limit: 200,
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'script.list', {
      workspaceId: 'ws-1',
      archive: 'active',
      limit: 200,
      cursor: 'c-1',
    });
  });

  it('list reads an oversized definition whole through script.get', async () => {
    const hello = {
      server: {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        capabilities: { scriptActiveLists: 1, boundedReads: 1 },
      },
    };
    const { command: _command, ...rest } = DEV_SCRIPT;
    const omitted = { ...rest, commandOmitted: true, commandBytes: 600_000 };
    const whole: ScriptWithState = { ...DEV_SCRIPT, command: BIG_COMMAND };
    mockedRequest.mockResolvedValueOnce(hello).mockResolvedValueOnce({ scripts: [omitted] });
    for (const part of commandParts(BIG_COMMAND, BIG_CUTS))
      mockedRequest.mockResolvedValueOnce(part);
    const scripts = await new LiveScriptsClient().list('ws-1');

    expect(scripts).toEqual([whole]);
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'script.get', {
      workspaceId: 'ws-1',
      scriptId: 's-1',
    });
  });

  /** `script.get` parts of `command`, cut at the given UTF-8 byte offsets. */
  function commandParts(command: string, cuts: number[]) {
    const bytes = new TextEncoder().encode(command);
    const decoder = new TextDecoder();
    const starts = [0, ...cuts];
    return starts.map((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1] : bytes.length;
      return {
        ...DEV_SCRIPT,
        command: decoder.decode(bytes.slice(start, end)),
        commandTruncated: true,
        commandBytes: bytes.length,
        commandOffset: start,
        nextCommandOffset: end < bytes.length ? end : null,
      };
    });
  }

  const ACTIVE_HELLO = {
    server: { protocolVersion: CURRENT_PROTOCOL_VERSION, capabilities: { scriptActiveLists: 1 } },
  };
  // Cut points land right after a multibyte character and inside an escape run.
  const BIG_COMMAND = `echo "${'"'.repeat(40)}é😀${'\\'.repeat(30)}" # done`;
  const byteEnd = (marker: string) =>
    new TextEncoder().encode(BIG_COMMAND.slice(0, BIG_COMMAND.indexOf(marker) + marker.length))
      .length;
  const BIG_CUTS = [byteEnd('é'), byteEnd('😀'), byteEnd('😀') + 13];

  it('get joins a command served in parts', async () => {
    const parts = commandParts(BIG_COMMAND, BIG_CUTS);
    mockedRequest.mockResolvedValueOnce(ACTIVE_HELLO);
    for (const part of parts) mockedRequest.mockResolvedValueOnce(part);
    const script = await new LiveScriptsClient().get('ws-1', 's-1');

    expect(script).toEqual({ ...DEV_SCRIPT, command: BIG_COMMAND });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'script.get', {
      workspaceId: 'ws-1',
      scriptId: 's-1',
    });
    BIG_CUTS.forEach((offset, i) =>
      expect(mockedRequest).toHaveBeenNthCalledWith(i + 3, 'script.get', {
        workspaceId: 'ws-1',
        scriptId: 's-1',
        commandOffset: offset,
      }),
    );
  });

  it('get restarts when the command changes between parts', async () => {
    const stale = commandParts(BIG_COMMAND, BIG_CUTS);
    const edited = `${BIG_COMMAND} # edited`;
    const fresh = commandParts(edited, BIG_CUTS);
    mockedRequest
      .mockResolvedValueOnce(ACTIVE_HELLO)
      .mockResolvedValueOnce(stale[0])
      .mockResolvedValueOnce(fresh[1]);
    for (const part of fresh) mockedRequest.mockResolvedValueOnce(part);
    const script = await new LiveScriptsClient().get('ws-1', 's-1');

    expect(script.command).toBe(edited);
  });

  it('get restarts when a same-size replacement lands between parts', async () => {
    // Same UTF-8 length and offsets: only the replacement's updatedAt differs.
    const edited = `E${BIG_COMMAND.slice(1)}`;
    const stale = commandParts(BIG_COMMAND, BIG_CUTS).map((p) => ({
      ...p,
      updatedAt: '2026-11-03T01:00:00Z',
    }));
    const fresh = commandParts(edited, BIG_CUTS).map((p) => ({
      ...p,
      updatedAt: '2026-11-03T01:00:01Z',
    }));
    expect(fresh[0].commandBytes).toBe(stale[0].commandBytes);
    mockedRequest
      .mockResolvedValueOnce(ACTIVE_HELLO)
      .mockResolvedValueOnce(stale[0])
      .mockResolvedValueOnce(fresh[1]);
    for (const part of fresh) mockedRequest.mockResolvedValueOnce(part);
    const script = await new LiveScriptsClient().get('ws-1', 's-1');

    expect(script.command).toBe(edited);
    expect(script.updatedAt).toBe('2026-11-03T01:00:01Z');
  });

  it('get refuses a part that does not move forward', async () => {
    const [first, second] = commandParts(BIG_COMMAND, BIG_CUTS);
    mockedRequest
      .mockResolvedValueOnce(ACTIVE_HELLO)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...second, nextCommandOffset: second.commandOffset });

    await expect(new LiveScriptsClient().get('ws-1', 's-1')).rejects.toThrow();
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });

  it('get stops after SCRIPT_GET_MAX_PARTS parts and treats the read as incomplete', async () => {
    const size = SCRIPT_GET_MAX_PARTS * 2;
    const part = (offset: number) => ({
      ...DEV_SCRIPT,
      command: 'a',
      commandTruncated: true,
      commandBytes: size,
      commandOffset: offset,
      nextCommandOffset: offset + 1 < size ? offset + 1 : null,
    });
    mockedRequest.mockResolvedValueOnce(ACTIVE_HELLO);
    mockedRequest.mockImplementation(async (_method: string, params: any) =>
      part(params?.commandOffset ?? 0),
    );

    try {
      await expect(new LiveScriptsClient().get('ws-1', 's-1')).rejects.toThrow();
      // hello + first part + at most SCRIPT_GET_MAX_PARTS - 1 follow-ups.
      expect(mockedRequest).toHaveBeenCalledTimes(SCRIPT_GET_MAX_PARTS + 1);
    } finally {
      mockedRequest.mockReset();
    }
  });

  it('get refuses a command whose parts do not add up to its size', async () => {
    const parts = commandParts(BIG_COMMAND, BIG_CUTS);
    parts[1] = { ...parts[1], command: parts[1].command.slice(1) };
    mockedRequest.mockResolvedValueOnce(ACTIVE_HELLO);
    for (const part of parts) mockedRequest.mockResolvedValueOnce(part);

    await expect(new LiveScriptsClient().get('ws-1', 's-1')).rejects.toThrow();
  });

  it('list rejects a repeated full-view cursor instead of looping', async () => {
    mockedRequest
      .mockResolvedValueOnce({
        server: { capabilities: { scriptActiveLists: 1, boundedReads: 1 } },
      })
      .mockResolvedValueOnce({ scripts: [DEV_SCRIPT], nextCursor: 'c-1' })
      .mockResolvedValueOnce({ scripts: [DEV_SCRIPT], nextCursor: 'c-1' });
    await expect(new LiveScriptsClient().list('ws-1')).rejects.toThrow();
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });

  it('list ignores nextCursor from a host without paged full lists', async () => {
    mockedRequest
      .mockResolvedValueOnce({ server: { capabilities: { scriptActiveLists: 1 } } })
      .mockResolvedValueOnce({ scripts: [DEV_SCRIPT], nextCursor: 'c-1' });
    expect(await new LiveScriptsClient().list('ws-1')).toEqual([DEV_SCRIPT]);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('create sends the exact §5.8 request and surfaces the created definition', async () => {
    const { runtime: _runtime, ...definition } = DEV_SCRIPT;
    mockedRequest.mockResolvedValueOnce(definition);
    const client = new LiveScriptsClient();

    const result = await client.create('ws-1', {
      name: 'dev',
      command: 'pnpm dev',
      mode: 'service',
      cwd: 'app',
      env: { PORT: '3000' },
      category: 'dev',
      autoStart: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith('script.create', {
      workspaceId: 'ws-1',
      name: 'dev',
      command: 'pnpm dev',
      mode: 'service',
      cwd: 'app',
      env: { PORT: '3000' },
      category: 'dev',
      autoStart: true,
    });
    expect(result).toEqual({ success: true, id: 's-1', script: definition });
  });

  it('refuses an ID upsert through the public creation API', async () => {
    const client = new LiveScriptsClient();
    const input = { name: 'renamed', command: 'true', mode: 'command' as const, scriptId: 's-1' };
    // @ts-expect-error Existing IDs are forbidden even through a widened object.
    const result = await client.create('ws-1', input);
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it.each(['saved', 'oneOff'] as const)(
    'forwards explicit %s purpose and returns the stored definition',
    async (purpose) => {
      const { runtime: _runtime, ...definition } = {
        ...DEV_SCRIPT,
        mode: 'command' as const,
        autoStart: false,
        purpose,
      };
      mockedRequest.mockResolvedValueOnce(definition);
      const input = { name: 'test', command: 'pnpm test', mode: 'command' as const, purpose };
      expect(await new LiveScriptsClient().create('ws-1', input)).toEqual({
        success: true,
        id: definition.id,
        script: definition,
      });
      expect(mockedRequest).toHaveBeenCalledWith('script.create', {
        workspaceId: 'ws-1',
        ...input,
      });
    },
  );

  it('create omits optional params and folds a daemon error to a failed result', async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce({ id: 's-2' });
    await client.create('ws-1', { name: 'x', command: 'y', mode: 'command' });
    expect(mockedRequest).toHaveBeenCalledWith('script.create', {
      workspaceId: 'ws-1',
      name: 'x',
      command: 'y',
      mode: 'command',
    });

    mockedRequest.mockRejectedValueOnce(new Error('mode is required'));
    const failed = await client.create('ws-1', { name: 'x', command: 'y', mode: 'command' });
    expect(failed).toEqual({ success: false, error: 'mode is required' });
  });

  it.each([
    ['start', 'script.start'],
    ['stop', 'script.stop'],
    ['restart', 'script.restart'],
  ] as const)(
    '%s forwards %s with workspaceId + scriptId (router requires workspaceId, §5.8)',
    async (method, wireMethod) => {
      mockedRequest.mockResolvedValueOnce({ ok: true, scriptId: 's-1' });
      const client = new LiveScriptsClient();

      const result = await client[method]('ws-1', 's-1');

      expect(mockedRequest).toHaveBeenCalledWith(wireMethod, {
        workspaceId: 'ws-1',
        scriptId: 's-1',
      });
      expect(result).toEqual({ success: true });
    },
  );

  it('output forwards workspaceId + maxLines and returns the bare output-buffer string', async () => {
    mockedRequest.mockResolvedValueOnce('[2 lines]\nready\nlistening');
    const client = new LiveScriptsClient();

    const output = await client.output('ws-1', 's-1', 10);

    expect(mockedRequest).toHaveBeenCalledWith('script.output', {
      workspaceId: 'ws-1',
      scriptId: 's-1',
      maxLines: 10,
    });
    expect(output).toBe('[2 lines]\nready\nlistening');
  });

  it('status forwards workspaceId, returns the runtime state verbatim and folds errors to null', async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce(DEV_SCRIPT.runtime);
    expect(await client.status('ws-1', 's-1')).toEqual(DEV_SCRIPT.runtime);
    expect(mockedRequest).toHaveBeenCalledWith('script.status', {
      workspaceId: 'ws-1',
      scriptId: 's-1',
    });

    mockedRequest.mockRejectedValueOnce(new Error('script s-1 not found'));
    expect(await client.status('ws-1', 's-1')).toBeNull();
  });

  it('run forwards the §5.8 run envelope with workspaceId and returns it verbatim', async () => {
    mockedRequest.mockResolvedValueOnce({ exitCode: 0, output: 'ok', timedOut: false });
    const client = new LiveScriptsClient();

    const result = await client.run('ws-1', 's-1', { maxLines: 50, timeoutSeconds: 30 });

    expect(mockedRequest).toHaveBeenCalledWith('script.run', {
      workspaceId: 'ws-1',
      scriptId: 's-1',
      maxLines: 50,
      timeoutSeconds: 30,
    });
    expect(result).toEqual({ exitCode: 0, output: 'ok', timedOut: false });
  });
});

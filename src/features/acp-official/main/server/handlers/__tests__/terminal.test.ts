import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.hoisted(() => vi.fn());
const mockEmitter = vi.hoisted(() => {
  const emitter = new (require('node:events').EventEmitter)();
  return emitter;
});

vi.mock('../../../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => Object.assign(mockEmitter, { request: mockRequest }),
  // RESUB-1: ensureSubscription installs a reconnect listener; these tests
  // do not exercise reconnect so the mock is a no-op disposer.
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('../../../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    error = vi.fn();
    info = vi.fn();
    warn = vi.fn();
  },
}));

import { TerminalHandler, isLikelyLongRunningCommand } from '../terminal';

/** Base64-encode a UTF-8 string via Node Buffer (mirrors the handler). */
function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** Emit an `events.event` daemon notification onto the mocked client. */
function emitEvent(event: unknown, subscriptionId = 'sub-1'): void {
  mockEmitter.emit('notification', {
    method: 'events.event',
    params: { subscriptionId, event },
  });
}

describe('TerminalHandler (daemon-backed)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    (mockEmitter as EventEmitter).removeAllListeners();
  });

  it('routes createTerminal through terminal.create with the daemon-shaped params', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-1' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('git', ['status']);

    expect(id).toMatch(/^term_/);
    expect(mockRequest).toHaveBeenCalledWith('terminal.create', {
      workspaceId: 'ws-abc',
      cols: 80,
      rows: 24,
      cwd: '/workspace',
      command: 'git status',
    });
    expect(mockRequest).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['terminal:data', 'terminal:exit'],
      workspaceId: 'ws-abc',
    });
  });

  it('applies scope to the default cwd when workspacePath+scope are set', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-2' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', 'apps/web', 'ws-abc');
    await handler.createTerminal('ls');

    expect(mockRequest).toHaveBeenCalledWith(
      'terminal.create',
      expect.objectContaining({ cwd: '/workspace/apps/web', command: 'ls' }),
    );
  });

  it('shell-quotes args that contain whitespace or quotes', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-3' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    await handler.createTerminal('git', ['status', "path with spaces's.txt"]);

    expect(mockRequest).toHaveBeenCalledWith(
      'terminal.create',
      expect.objectContaining({
        command: "git status 'path with spaces'\\''s.txt'",
      }),
    );
  });

  it('writeToTerminal base64-encodes payloads onto terminal.write', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-4' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      if (method === 'terminal.write') return { ok: true };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('cat');
    await handler.writeToTerminal(id, 'hello\n');

    expect(mockRequest).toHaveBeenCalledWith('terminal.write', {
      terminalId: 'daemon-t-4',
      data: b64('hello\n'),
    });
  });

  it('buffers streamed terminal:data chunks (base64-decoded) into getOutput', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-5' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('ls');

    emitEvent({
      type: 'terminal:data',
      data: { terminalId: 'daemon-t-5', chunk: b64('file.txt\n') },
    });

    expect(handler.getOutput(id)).toEqual(['file.txt\n']);
  });

  it('resolves waitForExit when terminal:exit arrives', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-6' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('sh');
    const waited = handler.waitForExit(id);

    emitEvent({ type: 'terminal:exit', data: { terminalId: 'daemon-t-6', exitCode: 0 } });

    await expect(waited).resolves.toEqual({ exitCode: 0, signal: null });
    expect(handler.getStatus(id)).toEqual({
      running: false,
      exitStatus: { exitCode: 0, signal: null },
    });
  });

  it('killTerminal calls terminal.kill with the daemon terminal id', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-7' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      if (method === 'terminal.kill') return { ok: true };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('sh');
    await handler.killTerminal(id);

    expect(mockRequest).toHaveBeenCalledWith('terminal.kill', { terminalId: 'daemon-t-7' });
  });

  it('drops the events subscription on dispose', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-8' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      if (method === 'events.unsubscribe') return { ok: true };
      if (method === 'terminal.kill') return { ok: true };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    await handler.createTerminal('sh');
    await handler.dispose();

    expect(mockRequest).toHaveBeenCalledWith('events.unsubscribe', { subscriptionId: 'sub-1' });
  });

  it('ignores events tagged with a different subscriptionId', async () => {
    mockRequest.mockImplementation((method: string) => {
      if (method === 'terminal.create') return { terminalId: 'daemon-t-9' };
      if (method === 'events.subscribe') return { subscriptionId: 'sub-mine' };
      return {};
    });

    const handler = new TerminalHandler('/workspace', undefined, 'ws-abc');
    const id = await handler.createTerminal('ls');

    emitEvent(
      {
        type: 'terminal:data',
        data: { terminalId: 'daemon-t-9', chunk: b64('should-not-appear') },
      },
      'sub-other',
    );

    expect(handler.getOutput(id)).toEqual([]);
  });
});

describe('isLikelyLongRunningCommand', () => {
  it('flags npm run dev', () => {
    expect(isLikelyLongRunningCommand('npm', ['run', 'dev'])).toContain('Dev server');
  });
  it('flags vite', () => {
    expect(isLikelyLongRunningCommand('vite')).toContain('Dev server tool');
  });
  it('flags docker compose up without -d', () => {
    expect(isLikelyLongRunningCommand('docker compose up')).toContain('docker compose');
  });
  it('accepts docker compose up -d', () => {
    expect(isLikelyLongRunningCommand('docker compose up -d')).toBeNull();
  });
  it('flags --watch', () => {
    expect(isLikelyLongRunningCommand('tsc --watch')).toContain('--watch');
  });
  it('accepts a plain git command', () => {
    expect(isLikelyLongRunningCommand('git', ['status'])).toBeNull();
  });
});


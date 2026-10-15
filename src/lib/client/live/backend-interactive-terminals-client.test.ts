import { describe, it, expect, vi } from 'vitest';
import { createBackendInteractiveTerminalsClient } from './backend-interactive-terminals-client';
import type { BackendRuntime } from './backend-transport-runtime';

function harness() {
  let active = true;
  const wire = vi.fn(async (method: string) =>
    method === 'terminal.create' ? { terminalId: 'pty-1' } : { ok: true },
  );
  const request = vi.fn(
    async (method: string, params?: unknown, options?: { onDispatch?: () => void }) => {
      options?.onDispatch?.();
      return wire(method, params);
    },
  );
  const backend = {
    backendRequest: request,
    backendSubscribe: vi.fn().mockResolvedValue({ subscriptionId: 'sub' }),
    backendUnsubscribe: vi.fn(),
    onBackendNotification: vi.fn(() => () => {}),
    onBackendReconnected: vi.fn(() => () => {}),
  } as unknown as BackendRuntime;
  const client = createBackendInteractiveTerminalsClient(backend, {
    strict: true,
    guard: () => {
      if (!active) throw new Error('retired');
    },
  });
  return {
    client,
    wire,
    request,
    backend,
    retire: () => {
      active = false;
    },
  };
}
describe('strict terminal receipts', () => {
  it('retains ambiguous dispatched create and kill results without resending', async () => {
    const { client, wire } = harness();
    wire.mockRejectedValue(new Error('lost acknowledgement'));
    expect(await client.create({ workspaceId: 'ws', cols: 80, rows: 24 })).toMatchObject({
      success: false,
      terminalOutcome: 'unknown',
    });
    expect(await client.kill('pty-1', 'ws')).toMatchObject({
      success: false,
      terminalOutcome: 'unknown',
    });
    expect(wire).toHaveBeenCalledTimes(2);
  });
  it('rejects before dispatch after retirement', async () => {
    const { client, wire, retire } = harness();
    retire();
    expect(await client.create({ workspaceId: 'ws', cols: 80, rows: 24 })).toEqual({
      success: false,
      error: 'retired',
    });
    expect(wire).not.toHaveBeenCalled();
  });
  it('does not treat malformed receipts or unavailable buffers as success', async () => {
    const { client, wire } = harness();
    wire.mockResolvedValue({} as never);
    expect(await client.create({ workspaceId: 'ws', cols: 80, rows: 24 })).toMatchObject({
      terminalOutcome: 'unknown',
    });
    expect(await client.kill('pty-1', 'ws')).toMatchObject({ terminalOutcome: 'unknown' });
    await expect(client.getBuffer('pty-1', undefined, 'ws')).rejects.toThrow();
    await expect(client.list('ws')).rejects.toThrow();
  });
  it('encodes Unicode input once and preserves an empty valid buffer', async () => {
    const { client, wire } = harness();
    await client.write('pty-1', 'printf 雪\n', 'ws');
    expect(wire).toHaveBeenCalledWith('terminal.write', {
      terminalId: 'pty-1',
      workspaceId: 'ws',
      data: btoa(String.fromCharCode(...new TextEncoder().encode('printf 雪\n'))),
    });
    wire.mockResolvedValue({ data: '' } as never);
    expect(await client.getBuffer('pty-1', undefined, 'ws')).toBe('');
  });
  it('retires late subscriptions and never automatically recreates on reconnect', async () => {
    const { client, backend } = harness();
    let resolve!: (value: unknown) => void;
    vi.mocked(backend.backendSubscribe).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }) as never,
    );
    const stop = client.subscribeEvents('pty-1', {}, 'ws');
    stop();
    resolve({ subscriptionId: 'late' });
    await stop.ready;
    expect(backend.backendUnsubscribe).toHaveBeenCalledWith('late', 'ws');
    expect(backend.onBackendReconnected).not.toHaveBeenCalled();
  });
});

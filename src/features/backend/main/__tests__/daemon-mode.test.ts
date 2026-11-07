import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/paraglide/messages.js', () => ({ m: {} }));

import { JsonRpcError } from '../json-rpc-errors';
import { detectDaemonMode, reportedDaemonMode } from '../daemon-mode';

const hello = (daemonMode?: unknown) => ({
  server: { version: '0.11.150', ...(daemonMode === undefined ? {} : { daemonMode }) },
});

const nodeRefusal = () =>
  new JsonRpcError({
    code: -32003,
    message: 'refused in node mode',
    data: { code: 'node-mode', detail: 'workspace.list' },
  });

describe('reportedDaemonMode', () => {
  it('reads the reported mode', () => {
    expect(reportedDaemonMode(hello('node'))).toBe('node');
    expect(reportedDaemonMode(hello('regular'))).toBe('regular');
  });

  it('treats a missing or unknown value as unknown', () => {
    expect(reportedDaemonMode(hello())).toBeNull();
    expect(reportedDaemonMode(hello('hub'))).toBeNull();
    expect(reportedDaemonMode(hello(1))).toBeNull();
    expect(reportedDaemonMode(null)).toBeNull();
    expect(reportedDaemonMode({ server: 'x' })).toBeNull();
  });
});

describe('detectDaemonMode', () => {
  it('uses the reported mode without probing', async () => {
    const request = vi.fn();
    await expect(detectDaemonMode(hello('node'), request)).resolves.toBe('node');
    await expect(detectDaemonMode(hello('regular'), request)).resolves.toBe('regular');
    expect(request).not.toHaveBeenCalled();
  });

  it('probes an older daemon once: a node-mode refusal means node', async () => {
    const request = vi.fn().mockRejectedValue(nodeRefusal());
    await expect(detectDaemonMode(hello(), request)).resolves.toBe('node');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('workspace.get');
  });

  it('a probe result means regular', async () => {
    const request = vi.fn().mockResolvedValue({ workspaces: [] });
    await expect(detectDaemonMode(hello(), request)).resolves.toBe('regular');
  });

  it('a daemon error without the node-mode code means regular', async () => {
    const forbidden = new JsonRpcError({ code: -32003, message: 'forbidden' });
    await expect(detectDaemonMode(hello(), vi.fn().mockRejectedValue(forbidden))).resolves.toBe(
      'regular',
    );
    const missing = new JsonRpcError({ code: -32601, message: 'no such method' });
    await expect(detectDaemonMode(hello(), vi.fn().mockRejectedValue(missing))).resolves.toBe(
      'regular',
    );
  });

  it('a transport failure or timeout leaves the mode unknown', async () => {
    await expect(
      detectDaemonMode(hello(), vi.fn().mockRejectedValue(new Error('socket closed'))),
    ).resolves.toBeNull();
    await expect(
      detectDaemonMode(hello(), vi.fn().mockRejectedValue(new Error('Request timed out'))),
    ).resolves.toBeNull();
  });

  it('a serialized node-mode refusal (rpcCode on a plain object) still means node', async () => {
    const payload = { rpcCode: -32003, data: { code: 'node-mode' } };
    await expect(detectDaemonMode(hello(), vi.fn().mockRejectedValue(payload))).resolves.toBe(
      'node',
    );
  });
});

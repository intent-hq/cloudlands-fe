import { describe, expect, it, vi } from 'vitest';
import { JsonRpcError } from './json-rpc-errors';
import { PresenceAggregator } from './presence-aggregator';

const unsupported = () => new JsonRpcError({ code: -32601, message: 'Method not found' });

describe('PresenceAggregator', () => {
  it('merges every window of a backend into one update and coalesces a burst', async () => {
    let release: (() => void) | undefined;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, typingSource: 'ts-1' });
          }),
      )
      .mockResolvedValue({ ok: true, typingSource: 'ts-1' });
    const aggregator = new PresenceAggregator(request);

    const first = aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-1' }] });
    const second = aggregator.report('backend', 2, {
      focus: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2', agentId: 'a' }],
      typing: { agentId: 'a' },
    });
    const third = aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-3' }] });
    expect(request).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second, third]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('backend', {
      focus: [
        { workspaceId: 'ws-3' },
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2', agentId: 'a' },
      ],
      typing: { agentId: 'a' },
    });
    expect(await third).toBe('ts-1');
  });

  it('latches an unsupported daemon until reconnect, then sends again', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(unsupported())
      .mockResolvedValue({ ok: true, typingSource: 'ts-new' });
    const aggregator = new PresenceAggregator(request);

    expect(await aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-1' }] })).toBeNull();
    expect(await aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-2' }] })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);

    aggregator.reconnected('backend');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(await aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-3' }] })).toBe(
      'ts-new',
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith('backend', {
      focus: [{ workspaceId: 'ws-3' }],
      typing: null,
    });
  });

  it('recovers on reconnect when a report joined the in-flight unsupported probe', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(unsupported())
      .mockResolvedValue({ ok: true, typingSource: 'ts-new' });
    const aggregator = new PresenceAggregator(request);

    const first = aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-1' }] });
    const second = aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-2' }] });
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(1);

    aggregator.reconnected('backend');
    expect(request).toHaveBeenCalledTimes(2);
    expect(await aggregator.report('backend', 1, { focus: [{ workspaceId: 'ws-2' }] })).toBe(
      'ts-new',
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
});

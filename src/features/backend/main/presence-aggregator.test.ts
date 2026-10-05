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

describe('window contribution ownership', () => {
  it('moves one window between backends without replaying its old focus', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'source' });
    const aggregator = new PresenceAggregator(request);
    await aggregator.report('old', 1, { focus: [{ workspaceId: 'private-old' }] });
    await aggregator.report('old', 2, { focus: [{ workspaceId: 'stays' }] });
    await aggregator.report('new', 1, { focus: [{ workspaceId: 'new' }] });
    expect(aggregator.merged('old')).toEqual({ focus: [{ workspaceId: 'stays' }], typing: null });
    aggregator.reconnected('old');
    expect(request).toHaveBeenLastCalledWith('old', {
      focus: [{ workspaceId: 'stays' }],
      typing: null,
    });
  });
  it('clears only a disabled window, preserving another window’s focus and typing', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'source' });
    const aggregator = new PresenceAggregator(request);
    await aggregator.report('host', 1, {
      focus: [{ workspaceId: 'gone' }],
      typing: { agentId: 'gone-agent' },
    });
    await aggregator.report('host', 2, {
      focus: [{ workspaceId: 'stays' }],
      typing: { agentId: 'stays-agent' },
    });
    await aggregator.report('host', 1, { focus: [], typing: null });
    aggregator.reconnected('host');
    expect(request).toHaveBeenLastCalledWith('host', {
      focus: [{ workspaceId: 'stays' }],
      typing: { agentId: 'stays-agent' },
    });
  });
});

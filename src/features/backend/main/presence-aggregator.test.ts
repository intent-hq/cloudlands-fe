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

  it('suppresses unchanged non-typing unions across windows and focus order', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'source' });
    const aggregator = new PresenceAggregator(request);
    const a = { workspaceId: 'a' };
    const b = { workspaceId: 'b', agentId: 'agent' };
    await aggregator.report('host', 1, { focus: [a, b] });
    await aggregator.report('host', 1, { focus: [b, a, a], typing: null });
    await aggregator.report('host', 2, { focus: [a] });
    aggregator.dropWindow(2);
    await aggregator.report('host', 1, { focus: [a, b] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(await aggregator.report('host', 1, { focus: [a, b] })).toBe('source');
    aggregator.dropWindow(1);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('host', { focus: [], typing: null });
  });

  it('coalesces identical reports that arrive during a successful send', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ ok: true, typingSource: 'source' });
    const aggregator = new PresenceAggregator(request);
    const params = { focus: [{ workspaceId: 'ws' }] };
    const first = aggregator.report('host', 1, params);
    const second = aggregator.report('host', 2, params);
    resolve({ ok: true, typingSource: 'source' });
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retains identical typing pulses, clearing typing, retries, and backend isolation', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'source' });
    const aggregator = new PresenceAggregator(request);
    const focus = [{ workspaceId: 'ws' }];
    await aggregator.report('host', 1, { focus, typing: { agentId: 'a' } });
    await aggregator.report('host', 1, { focus, typing: { agentId: 'a' } });
    await aggregator.report('host', 1, { focus, typing: null });
    await aggregator.report('host', 1, { focus, typing: null });
    expect(request).toHaveBeenCalledTimes(3);
    request.mockRejectedValueOnce(new Error('lost'));
    await aggregator.report('host', 1, { focus: [] });
    await aggregator.report('host', 1, { focus: [] });
    expect(request).toHaveBeenCalledTimes(5);
    await aggregator.report('other', 2, { focus: [] });
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('reasserts unchanged focus on reconnect even if an old send completes afterward', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ ok: true, typingSource: 'new' });
    const aggregator = new PresenceAggregator(request);
    const first = aggregator.report('host', 1, { focus: [{ workspaceId: 'ws' }] });
    aggregator.reconnected('host');
    resolve({ ok: true, typingSource: 'old' });
    expect(await first).toBe('new');
    expect(request).toHaveBeenCalledTimes(2);
    await aggregator.report('host', 1, { focus: [{ workspaceId: 'ws' }] });
    expect(request).toHaveBeenCalledTimes(2);
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
    expect(request).toHaveBeenCalledTimes(2);
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

describe('discussion typing aggregation', () => {
  it('merges independent agent/discussion targets and removes only the closing window contribution', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'own' });
    const aggregator = new PresenceAggregator(request);
    await aggregator.report('host', 1, {
      focus: [{ workspaceId: 'one' }],
      typing: { agentId: 'agent' },
    });
    await aggregator.report('host', 2, {
      focus: [{ workspaceId: 'two' }],
      discussionTyping: { workspaceId: 'two' },
    });
    expect(request).toHaveBeenLastCalledWith('host', {
      focus: [{ workspaceId: 'one' }, { workspaceId: 'two' }],
      typing: { agentId: 'agent' },
      discussionTyping: { workspaceId: 'two' },
    });
    await aggregator.report('host', 3, { focus: [], discussionTyping: { workspaceId: 'three' } });
    expect(aggregator.merged('host').discussionTyping).toEqual({ workspaceId: 'three' });
    aggregator.dropWindow(3);
    await Promise.resolve();
    expect(aggregator.merged('host').discussionTyping).toEqual({ workspaceId: 'two' });
    await aggregator.report('host', 2, { focus: [{ workspaceId: 'two' }], discussionTyping: null });
    expect(request).toHaveBeenLastCalledWith('host', {
      focus: [{ workspaceId: 'one' }, { workspaceId: 'two' }],
      typing: { agentId: 'agent' },
    });
  });
  it('preserves pulses, transmits one clear, isolates backends, and never replays discussion typing after reconnect', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'own' });
    const aggregator = new PresenceAggregator(request);
    const focus = [{ workspaceId: 'ws' }];
    const active = { focus, discussionTyping: { workspaceId: 'ws' } };
    await aggregator.report('host', 1, active);
    await aggregator.report('host', 1, active);
    expect(request).toHaveBeenCalledTimes(2);
    await aggregator.report('host', 1, { focus });
    await aggregator.report('host', 1, { focus });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith('host', { focus, typing: null });
    await aggregator.report('host', 1, active);
    await aggregator.report('other', 2, active);
    aggregator.reconnected('host');
    await Promise.resolve();
    expect(aggregator.merged('host')).toEqual({ focus, typing: null });
    expect(aggregator.merged('other').discussionTyping).toEqual({ workspaceId: 'ws' });
    await aggregator.report('other', 1, { focus: [] });
    expect(aggregator.merged('host')).toEqual({ focus: [], typing: null });
  });
  it('serializes a discussion clear behind an in-flight pulse', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ ok: true, typingSource: 'own' });
    const aggregator = new PresenceAggregator(request);
    const active = aggregator.report('host', 1, {
      focus: [],
      discussionTyping: { workspaceId: 'ws' },
    });
    const clear = aggregator.report('host', 1, { focus: [] });
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ ok: true, typingSource: 'own' });
    await Promise.all([active, clear]);
    expect(request.mock.calls.map(([, params]) => params)).toEqual([
      { focus: [], typing: null, discussionTyping: { workspaceId: 'ws' } },
      { focus: [], typing: null },
    ]);
  });
});

it('merges conversation targets across windows independently of agent typing and clears on reconnect', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, typingSource: 'pooled' });
  const aggregator = new PresenceAggregator(request);
  await aggregator.report('host', 1, {
    focus: [{ workspaceId: 'ws' }],
    typing: { agentId: 'agent' },
    discussionTyping: { workspaceId: 'ws', conversationId: 'c1' },
  });
  await aggregator.report('host', 2, {
    focus: [{ workspaceId: 'ws' }],
    discussionTyping: { workspaceId: 'ws', conversationId: 'c2' },
  });
  expect(request).toHaveBeenLastCalledWith('host', {
    focus: [{ workspaceId: 'ws' }],
    typing: { agentId: 'agent' },
    discussionTyping: { workspaceId: 'ws', conversationId: 'c2' },
  });
  await aggregator.report('host', 2, { focus: [], discussionTyping: null });
  expect(request.mock.calls.at(-1)?.[1].discussionTyping).toEqual({
    workspaceId: 'ws',
    conversationId: 'c1',
  });
});

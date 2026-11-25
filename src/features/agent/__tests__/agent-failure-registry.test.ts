import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAgentFailureRegistry,
  getAgentFailureEntry,
  listAgentFailureEntries,
  listDelegatedAgentFailures,
  recordAgentFailure,
  recordDelegatedAgentFailure,
  removeAgentFailure,
  removeAgentFailureIfSwitched,
  subscribeToAgentFailures,
  updateAgentFailureIdentity,
} from '../agent-failure-registry';

afterEach(() => {
  clearAgentFailureRegistry();
});

describe('agent-failure-registry entries', () => {
  it('lists one entry per failed agent ordered oldest-first, never grouped', () => {
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-b',
      error: 'Connection to 10.0.0.2:9090 refused',
      at: 2,
    });
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection to 10.0.0.1:8080 refused',
      at: 1,
    });

    const entries = listAgentFailureEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.agentId)).toEqual(['agent-1', 'agent-2']);
    expect(entries.map((e) => e.workspaceId)).toEqual(['ws-a', 'ws-b']);
    expect(entries.map((e) => e.error)).toEqual([
      'Connection to 10.0.0.1:8080 refused',
      'Connection to 10.0.0.2:9090 refused',
    ]);
  });

  it('dedupes by agentId — the same agent failing twice keeps one entry', () => {
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 1,
    });
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Rate limit exceeded',
      at: 2,
    });

    const entries = listAgentFailureEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('Rate limit exceeded');
    expect(entries[0].at).toBe(2);
  });
});

describe('agent-failure-registry removal lifecycle', () => {
  it('removes agents one at a time until the registry is empty', () => {
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 1,
    });
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-b',
      error: 'Connection refused',
      at: 2,
    });

    expect(removeAgentFailure('agent-1')).toBe(true);
    let entries = listAgentFailureEntries();
    expect(entries.map((e) => e.agentId)).toEqual(['agent-2']);

    expect(removeAgentFailure('agent-2')).toBe(true);
    entries = listAgentFailureEntries();
    expect(entries).toHaveLength(0);
  });

  it('returns false for unknown agents', () => {
    expect(removeAgentFailure('agent-unknown')).toBe(false);
  });
});

describe('agent-failure-registry subscription', () => {
  it('notifies subscribers with the fresh entry snapshot on add/replace/remove', () => {
    const listener = vi.fn();
    subscribeToAgentFailures(listener);

    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);

    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 2,
    });
    expect(listener).toHaveBeenCalledTimes(2);

    removeAgentFailure('agent-1');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[2][0]).toHaveLength(0);
  });

  it('does not notify on a no-op removal', () => {
    const listener = vi.fn();
    subscribeToAgentFailures(listener);
    removeAgentFailure('agent-unknown');
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe and isolates throwing subscribers', () => {
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const listener = vi.fn();
    subscribeToAgentFailures(throwing);
    const unsubscribe = subscribeToAgentFailures(listener);

    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-a',
      error: 'Connection refused',
      at: 2,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});

describe('agent-failure-registry delegated list and identity', () => {
  it('tracks delegated failures without notifying the toast layer', () => {
    const listener = vi.fn();
    subscribeToAgentFailures(listener);
    recordDelegatedAgentFailure({
      agentId: 'w1',
      parentAgentId: 'c1',
      workspaceId: 'ws',
      error: 'quota',
      errorCode: 'quota-exceeded',
      provider: 'claude-code',
    });
    recordDelegatedAgentFailure({
      agentId: 'w2',
      parentAgentId: 'c2',
      workspaceId: 'ws',
      error: 'x',
    });
    expect(listener).not.toHaveBeenCalled();
    expect(listDelegatedAgentFailures('c1').map((e) => e.agentId)).toEqual(['w1']);
    expect(getAgentFailureEntry('w1')).toBeUndefined();

    expect(removeAgentFailure('w1')).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(listDelegatedAgentFailures('c1')).toEqual([]);
  });

  it('fills identity only on the exact entry it was read for', () => {
    const first = recordAgentFailure({ agentId: 'a', workspaceId: 'ws', error: 'e', at: 1 });
    expect(
      updateAgentFailureIdentity(first, { provider: 'codex', model: 'm', agentName: 'A' }),
    ).toBe(true);
    expect(getAgentFailureEntry('a')).toMatchObject({
      provider: 'codex',
      model: 'm',
      agentName: 'A',
      at: 1,
    });

    const stale = getAgentFailureEntry('a')!;
    recordAgentFailure({ agentId: 'a', workspaceId: 'ws', error: 'e2', at: 2 });
    expect(updateAgentFailureIdentity(stale, { provider: 'other' })).toBe(false);
    expect(getAgentFailureEntry('a')?.provider).toBeUndefined();
  });

  it('drops an entry whose provider or model changed while it stays failed', () => {
    recordAgentFailure({
      agentId: 'a',
      workspaceId: 'ws',
      error: 'e',
      provider: 'claude-code',
      model: 'opus',
    });
    expect(removeAgentFailureIfSwitched('a', { provider: 'claude-code', model: 'opus' })).toBe(
      false,
    );
    expect(removeAgentFailureIfSwitched('a', { provider: 'codex', model: 'opus' })).toBe(true);
    expect(getAgentFailureEntry('a')).toBeUndefined();

    recordDelegatedAgentFailure({
      agentId: 'w',
      parentAgentId: 'a',
      workspaceId: 'ws',
      error: 'e',
      provider: 'claude-code',
      model: 'opus',
    });
    expect(removeAgentFailureIfSwitched('w', { provider: 'claude-code', model: 'fable' })).toBe(
      true,
    );
    expect(listDelegatedAgentFailures('a')).toEqual([]);
  });

  it('keeps an entry with no recorded identity on any update', () => {
    recordAgentFailure({ agentId: 'a', workspaceId: 'ws', error: 'e' });
    expect(removeAgentFailureIfSwitched('a', { provider: 'codex', model: 'x' })).toBe(false);
    expect(getAgentFailureEntry('a')).toBeDefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAgentFailureRegistry,
  listAgentFailureEntries,
  recordAgentFailure,
  removeAgentFailure,
  subscribeToAgentFailures,
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
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Rate limit exceeded', at: 2 });

    const entries = listAgentFailureEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('Rate limit exceeded');
    expect(entries[0].at).toBe(2);
  });
});

describe('agent-failure-registry removal lifecycle', () => {
  it('removes agents one at a time until the registry is empty', () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-b', error: 'Connection refused', at: 2 });

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

    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);

    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 2 });
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

    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-a', error: 'Connection refused', at: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});

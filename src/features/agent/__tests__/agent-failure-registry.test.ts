import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeAgentError } from '../utils/normalize-agent-error';
import {
  clearAgentFailureRegistry,
  listAgentFailureGroups,
  recordAgentFailure,
  removeAgentFailure,
  subscribeToAgentFailures,
} from '../agent-failure-registry';

afterEach(() => {
  clearAgentFailureRegistry();
});

describe('normalizeAgentError', () => {
  it('collapses identical connectivity errors that differ only in variable fragments', () => {
    const a = normalizeAgentError(
      'Connection to 10.0.0.1:8080 failed for session 550e8400-e29b-41d4-a716-446655440000',
    );
    const b = normalizeAgentError(
      'Connection to 192.168.1.42:9999 failed for session 6fa459ea-ee8a-3ca4-894e-db77e160355e',
    );
    expect(a).toBe(b);
  });

  it('strips paths, hex ids, and numbers; is case- and whitespace-insensitive', () => {
    const a = normalizeAgentError('ENOENT: /Users/alice/project/file.ts (request deadbeef01)');
    const b = normalizeAgentError('enoent:  /home/bob/other/place.ts   (REQUEST 0xCAFEBABE)');
    expect(a).toBe(b);
    expect(a).not.toMatch(/alice|deadbeef|\d/);
  });

  it('keeps distinct errors distinct', () => {
    expect(normalizeAgentError('Connection refused')).not.toBe(
      normalizeAgentError('Rate limit exceeded'),
    );
  });

  it('maps blank input to a stable fallback key', () => {
    expect(normalizeAgentError('')).toBe('<unknown>');
    expect(normalizeAgentError('   ')).toBe('<unknown>');
  });
});

describe('agent-failure-registry grouping', () => {
  it('groups agents from different workspaces sharing one normalized error', () => {
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-a',
      error: 'Connection to 10.0.0.1:8080 refused',
      at: 1,
    });
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-b',
      error: 'Connection to 10.0.0.2:9090 refused',
      at: 2,
    });

    const groups = listAgentFailureGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.agentId)).toEqual(['agent-1', 'agent-2']);
    expect(groups[0].entries.map((e) => e.workspaceId)).toEqual(['ws-a', 'ws-b']);
    expect(groups[0].error).toBe('Connection to 10.0.0.2:9090 refused');
  });

  it('splits different errors into separate groups', () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-a', error: 'Out of memory', at: 2 });

    const groups = listAgentFailureGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0].entries[0].agentId).toBe('agent-1');
    expect(groups[1].entries[0].agentId).toBe('agent-2');
  });

  it('dedupes by agentId — the same agent failing twice keeps one entry', () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Rate limit exceeded', at: 2 });

    const groups = listAgentFailureGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].error).toBe('Rate limit exceeded');
  });
});

describe('agent-failure-registry removal lifecycle', () => {
  it('removes an agent and drops its group when empty', () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-a', error: 'Connection refused', at: 1 });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-b', error: 'Connection refused', at: 2 });

    expect(removeAgentFailure('agent-1')).toBe(true);
    let groups = listAgentFailureGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.agentId)).toEqual(['agent-2']);

    expect(removeAgentFailure('agent-2')).toBe(true);
    groups = listAgentFailureGroups();
    expect(groups).toHaveLength(0);
  });

  it('returns false for unknown agents', () => {
    expect(removeAgentFailure('agent-unknown')).toBe(false);
  });
});

describe('agent-failure-registry subscription', () => {
  it('notifies subscribers with the fresh group snapshot on add/replace/remove', () => {
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
